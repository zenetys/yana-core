'use strict';

const builder = require('../builder.js');
const config = require('../config.js');
const cache = require('../cache.js');
const handler = require('../handler.js');
const Logger = require('../logger.js');
const util = require('../util.js');

const OPTIONS = {
    log: new Logger('handler:interfaces'),
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
                    required: true,
                },
                id: {
                    type: 'string',
                    check: (x) => x.length > 0,
                },
            },
        },
    },
};

class HandlerInterfaces extends handler.Handler {

    constructor() {
        super(OPTIONS);
    }

    async process(ctx) {
        var db = await cache.getDb(ctx.url.params[0], ctx.url.qs.database);
        if (!db)
            return this.headEnd(ctx, db === null ? 400 : 500);

        if (!util.isObject(db.hiface)) {
            this.log.error('Invalid table hiface in database %s/%s ',
                ctx.url.params[0], ctx.url.qs.database);
            return this.headEnd(ctx, 500);
        }

        if (ctx.url.qs.id) {
            if (db.hiface[ctx.url.qs.id])
                db = db.hiface[ctx.url.qs.id];
            else
                db = null;
        }
        else {
            let out = [];
            for (let i in db.hiface)
                out = out.concat(db.hiface[i]);
            db = out;
        }

        this.headEnd(ctx, 200, JSON.stringify(db));
    }
}

handler.register('GET', '/entity/*/interfaces', new HandlerInterfaces());
