'use strict';

const EventEmitter = require('events');
const Logger = require(__dirname + '/logger.js');
const util = require(__dirname + '/util.js');

const DEFAULTS = {
    log: new Logger('handler'),
    rulesUrlParams: false,
    rulesQs: false,
    rulesData: false,
    contentType: undefined,
}

class Handler extends EventEmitter {

    constructor(options) {
        super();
        Object.assign(this, DEFAULTS, options);
    }

    process(ctx) {
        // implement
    }

    debugRequest(ctx) {
        if (!this.log.debug2('Print client request'))
            return; /* verbosity too low */
        this.log.dump(`${ctx.req.method} ${ctx.req.url} HTTP/${ctx.req.httpVersion}\n`);
        for (let i = 0; i < ctx.req.rawHeaders.length; i += 2)
            this.log.dump(`${ctx.req.rawHeaders[i]}: ${ctx.req.rawHeaders[i+1]}\n`);
        this.log.dump('\n' + ctx.rawData);
        if (ctx.rawData.length > 1 && ctx.rawData.substr(-1) != '\n')
            this.log.dump('\n');
    }

    checkData(ctx) {
        if (typeof ctx.req.headers['content-type'] != 'string' ||
            (ctx.req.headers['content-type'] != 'application/json' &&
             ctx.req.headers['content-type'].substr(0, 17) != 'application/json;')) {
            return { error: 'header content-type application/json required' }
        }

        try { ctx.data = JSON.parse(ctx.rawData); }
        catch (e) { return { error: e.message } }

        return util.checkData(ctx.data, this.rulesData);
    }

    async handle(ctx) {
        ctx.rawData = '';
        return new Promise((resolve, reject) => {
            this.debugRequest(ctx);
            ctx.req.on('data', (chunk) => {
                if (this.rulesData)
                    ctx.rawData += chunk
            });
            ctx.req.on('end', async () => {
                if (util.isObject(this.rulesUrlParams)) {
                    let result = util.checkData(ctx.urlParams, this.rulesUrlParams);
                    if (result.error) {
                        ctx.res.writeHead(400, { 'content-type': 'application/json' });
                        ctx.res.end(JSON.stringify({ error: `invalid variable url path: ${result.error}` }));
                        return resolve();
                    }
                }
                if (util.isObject(this.rulesQs)) {
                    let result = util.checkData(ctx.urlQs, this.rulesQs);
                    if (result.error) {
                        ctx.res.writeHead(400, { 'content-type': 'application/json' });
                        ctx.res.end(JSON.stringify({ error: `invalid query string: ${result.error}` }));
                        return resolve();
                    }
                }
                if (util.isObject(this.rulesData)) {
                    let result = this.checkData(ctx);
                    if (result.error) {
                        ctx.res.writeHead(400, { 'content-type': 'application/json' });
                        ctx.res.end(JSON.stringify({ error: `invalid data: ${result.error}` }));
                        return resolve();
                    }
                }
                if (this.contentType)
                    ctx.res.setHeader('content-type', this.contentType);
                let [e, result] = await util.safePromise(this.process(ctx));
                return e ? reject(e) : resolve(result);
            });
        });
    }
}

module.exports = Handler;
