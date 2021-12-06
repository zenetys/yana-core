'use strict';

const builder = require('../builder.js');
const config = require('../config.js');
const cache = require('../cache.js');
const dbhelpers = require('../dbhelpers.js');
const handler = require('../handler.js');
const Logger = require('../logger.js');
const util = require('../util.js');

const OPTIONS = {
    log: new Logger('handler:vlans'),
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
            },
        },
    },
};

class HandlerVlans extends handler.Handler {

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

        var db = await cache.getDb(ctx.url.params[0], ctx.url.qs.database);
        if (!db)
            return this.headEnd(ctx, db === null ? 400 : 500);

        if (!util.isObject(db.sdevice)) {
            this.log.error('Invalid table sdevice in database %s/%s ',
                ctx.url.params[0], ctx.url.qs.database);
            return this.headEnd(ctx, 500);
        }

        var out = [];
        for (let did in db.sdevice) {
            if (!db.sdevice[did].vlan)
                continue;
            out.push({
                id: db.sdevice[did].id,
                name: dbhelpers.getDeviceBestName(db, did, true),
                vlan: Object.values(db.sdevice[did].vlan),
            });
        }

        this.headEnd(ctx, 200, JSON.stringify(out));
    }
}

handler.register('GET', '/entity/*/vlans', new HandlerVlans());
