'use strict';

const EventEmitter = require('events');
const Logger = require(__dirname + '/logger.js');
const util = require(__dirname + '/util.js');

const DEFAULT_OPTIONS = {
    log: new Logger('handler'),
    inputData: {
        enabled: false, /* enable capture of client data */
        type: undefined, /* expected content-type */
        decoder: undefined, /* undefined: auto, null: don't decode, or function */
    },
    inputRules: {
        qs: undefined, /* query-string check rules */
        urlParams: undefined, /* url parameters check rules */
        data: undefined, /* decoded data check rules */
    },
    contentType: undefined, /* preset content-type reply header */
}

const DEFAULT_DECODERS = {
    'application/json': JSON.parse,
}

class Handler extends EventEmitter {

    constructor(options) {
        super();
        Object.assign(this, util.omerge({}, DEFAULT_OPTIONS, options));
    }

    debugRequest(ctx) {
        if (!this.log.debug2('Request headers from %s:%s',
                ctx.req.socket.remoteAddress, ctx.req.socket.remotePort)) {
            return; /* verbosity too low */
        }
        this.log.dump(`${ctx.req.method} ${ctx.req.url} HTTP/${ctx.req.httpVersion}`);
        for (let i = 0; i < ctx.req.rawHeaders.length; i += 2)
            this.log.dump(`${ctx.req.rawHeaders[i]}: ${ctx.req.rawHeaders[i+1]}`);
        this.log.dump();
    }

    debugData(ctx) {
        if (!this.log.debug2('Request data from %s:%s',
                ctx.req.socket.remoteAddress, ctx.req.socket.remotePort)) {
            return; /* verbosity too low */
        }
        var data = util.bufArr2str(ctx.rawData, 512)
        if (data.length)
            this.log.dump(data);
        this.log.dump(`# Dumped max 512 bytes of ${util.bufArrLen(ctx.rawData)} total`);
        this.log.dump(`# Full data SHA256 is ${util.sha256(ctx.rawData)}`);
    }

    checkInputHead(ctx) {
        var out = {};
        var e = (msg) => { out.error = msg; return out; }

        /* check url path parameters */
        if (this.inputRules.urlParams) {
            let result = util.checkData(ctx.url.params, this.inputRules.urlParams);
            if (result.error)
                return e(`invalid url params: ${result.error}`)
        }
        /* check query string parameters */
        if (this.inputRules.qs) {
            let result = util.checkData(ctx.url.qs, this.inputRules.qs);
            if (result.error)
                return e(`invalid query string: ${result.error}`)
        }
        /* check content-type */
        if (this.inputData.type &&
            (typeof ctx.req.headers['content-type'] != 'string' ||
             (ctx.req.headers['content-type'] != this.inputData.type &&
              ctx.req.headers['content-type']
                .substr(0, this.inputData.type.length + 1) != this.inputData.type + ';')))
            return e(`invalid data: content-type ${this.inputData.type} expected`);

        return out;
    }

    checkInputData(ctx) {
        var out = {};
        var e = (msg) => { out.error = msg; return out; }
        var decoder = this.inputData.decoder;

        if (decoder === undefined && DEFAULT_DECODERS[this.inputData.type])
            decoder = DEFAULT_DECODERS[this.inputData.type];
        if (decoder) {
            let rawString = util.bufArr2str(ctx.rawData);
            try { ctx.data = decoder(rawString); }
            catch (err) { return e(`invalid data: decode failed`); }
        }
        if (this.inputRules.data) {
            let result = util.checkData(ctx.data, this.inputRules.data);
            if (result.error)
                return e(`invalid data: ${result.error}`)
        }
        return out;
    }

    /* may be overriden to process data chunks on the fly */
    async readInputData(ctx) {
        for await (const chunk of ctx.req)
            ctx.rawData.push(chunk)
        this.debugData(ctx);
    }

    process(ctx) {
        // implement in a subclass
    }

    /* point of entry of the handler
     * assume this is try-catch'ed from the caller */
    async handle(ctx) {
        ctx.rawData = []; /* array of Buffer chunks */
        this.debugRequest(ctx);

        let check = this.checkInputHead(ctx);
        if (check.error) {
            ctx.res.writeHead(400, { 'content-type': 'application/json' });
            ctx.res.end(JSON.stringify({ error: check.error }));
            return;
        }

        if (this.inputData.enabled) {
            await this.readInputData(ctx);
            if (!ctx.req.readableEnded)
                return; /* input ended prematurely */
            check = this.checkInputData(ctx);
            if (check.error) {
                ctx.res.writeHead(400, { 'content-type': 'application/json' });
                ctx.res.end(JSON.stringify({ error: check.error }));
                return;
            }
        }

        if (this.contentType)
            ctx.res.setHeader('content-type', this.contentType);
        await this.process(ctx);
    }
}

module.exports = Handler;
