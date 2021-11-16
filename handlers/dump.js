'use strict';

const builder = require('../builder.js');
const config = require('../config.js');
const cache = require('../cache.js');
const handler = require('../handler.js');
const Logger = require('../logger.js');
const util = require('../util.js');

const OPTIONS = {
    log: new Logger('handler:dump'),
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
                database: {
                    type: 'string',
                    check: (x) => x.length > 0 && x.indexOf('.') != 0,
                },
                table: {
                    type: 'string',
                    check: (x) => x.length > 0,
                },
                list: {
                    type: 'string',
                    check: (x) => x == '' || x == '1',
                },
            },
        },
    },
};

class HandlerDump extends handler.Handler {

    constructor() {
        super(OPTIONS);
    }

    async process(ctx) {
        /* use latest database if none requested */
        if (!ctx.url.qs.database) {
            ctx.url.qs.database = cache.getLatestDbId(ctx.url.params[0]);
            if (ctx.url.qs.database instanceof Error)
                return this.headEnd(ctx, ctx.url.qs.database.code == 'ENOENT' ? 400 : 500);
            if (!ctx.url.qs.database)
                return this.headEnd(ctx, 404);
        }

        var out = await cache.getDb(ctx.url.params[0], ctx.url.qs.database);
        if (!out)
            return this.headEnd(ctx, out === null ? 400 : 500);

        if (ctx.url.qs.list !== undefined) {
            /* list tables */
            out = Object.keys(out);
        }
        else if (ctx.url.qs.table) {
            if (!out[ctx.url.qs.table])
                return this.headEnd(ctx, 404);
            out = out[ctx.url.qs.table];
        }

        this.headEnd(ctx, 200, JSON.stringify(out));
    }
}

handler.register('GET', '/entity/*/dump', new HandlerDump());
