'use strict';

const cache = require('../cache.js');
const config = require('../config.js');
const events = require('events');
const fs = require('fs');
const handler = require('../handler.js');
const Logger = require('../logger.js');
const util = require('../util.js');
const zlib = require('zlib');

const OPTIONS = {
    log: new Logger('handler:nscan'),
    contentType: 'application/json',
    inputRules: {
        urlParams: {
            type: 'array',
            min: 1,
            max: 1,
            elems: {
                type: 'string',
                check: (x) => x.length > 0 && x.indexOf('.') != 0,
             },
        },
        qs: {
            type: 'object',
            fields: {
                id: {
                    type: 'string',
                    check: (x) => x.length > 0 && x.indexOf('.') != 0,
                    required: true
                },
                ts: {
                    type: 'number'
                },
            },
        },
    },
    inputData: {
        enabled: true,
        type: 'application/x-nscan',
        decoder: null,
    }
};

class HandlerNscan extends handler.Handler {

    constructor() {
        super(OPTIONS);
    }

    async readInputData(ctx) {
        ctx.ulDir = config.options.dataDir + '/' + ctx.url.params[0];
        ctx.ulFile = ctx.url.qs.id + '.nscan.gz';
        ctx.ulTmp = '.upload.' + util.ranstr(4);

        try { fs.mkdirSync(ctx.ulDir, { recursive: true }); }
        catch(e) {
            this.log.error('Failed to create entity directory %s.',
                ctx.url.params[0], e);
            return false;
        }

        var file = `${ctx.ulDir}/${ctx.ulFile}${ctx.ulTmp}`;
        var gzip = zlib.createGzip();
        var writer = fs.createWriteStream(file);

        ctx.req.on('aborted', () => writer.close());
        ctx.req.pipe(gzip).pipe(writer);

        try { await events.once(writer, 'close'); }
        catch(e) {
            this.log.error('Upload failed for entity %s.', ctx.url.params[0], e);
            util.tryBool(() => fs.unlinkSync(file));
            return false;
        }

        if (ctx.url.qs.ts) {
            try { fs.utimesSync(file, ctx.url.qs.ts, ctx.url.qs.ts); }
            catch(e) {
                this.log.error('Could not set time on upload for entity %s.',
                    ctx.url.params[0], e);
                util.tryWrap(() => fs.unlinkSync(file));
                return false;
            }
        }

        return true;
    }

    async process(ctx) {
        try {
            fs.renameSync(`${ctx.ulDir}/${ctx.ulFile}${ctx.ulTmp}`,
                `${ctx.ulDir}/${ctx.ulFile}`); /* may overwrite existing */
        }
        catch(e) {
            this.log.error('Failed to rename upload for entity %s.',
                ctx.url.params[0], e);
            return this.headEnd(ctx, 500);
        }

        this.headEnd(ctx, 200);

        /* pre-load database in background */
        this.log.info('Preload database %s/%s', ctx.url.params[0], ctx.url.qs.id);
        cache.getDb(ctx.url.params[0], ctx.url.qs.id, true);
    }
}

handler.register('POST', '/entity/*/nscan', new HandlerNscan());
