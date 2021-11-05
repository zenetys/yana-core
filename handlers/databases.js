'use strict';

const config = require('../config.js');
const handler = require('../handler.js');
const Logger = require('../logger.js');
const util = require('../util.js');
const fs = require('fs');

const OPTIONS = {
    log: new Logger('handler:databases'),
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
    },
};

function lsDirApplyCb(out, dir, name, stat) {
    if (!stat.isFile())
        return;
    if (name.substr(-5) != '.json')
        return;
    /* Return an object per database with two properties:
     * id and timestamp. The timestamp is taken from the filename when
     * possible, otherwise the mtime is used. */
    var db = { id: name.substr(0, name.length-5) };
    db.ts = (new Date(db.id)).getTime();
    if (isNaN(db.ts)) {
        db.ts = (new Date(stat.mtimeMs)).getTime();
        if (isNaN(db.ts)) /* should not happen */
            return;
    }
    db.ts /= 1000; /* epoch seconds */
    out.push(db);
}

class HandlerDatabases extends handler.Handler {

    constructor() {
        super(OPTIONS);
    }

    async process(ctx) {
        var eDir = config.options.dataDir + '/' + ctx.url.params[0];
        var databases;

        try {
            databases = util.lsDirSync(eDir,
                { lstat: true, apply: lsDirApplyCb });
        }
        catch (e) {
            if (e.code == 'ENOENT')
                return this.headEnd(ctx, 404);
            else {
                this.log.error('Failed to list databases for %s',
                    ctx.url.params[0], e);
                return this.headEnd(ctx, 500);
            }
        }

        /* short by timestamp */
        databases.sort(util.makeCmpKey('ts', 1));
        this.headEnd(ctx, 200, JSON.stringify(databases));
    }
}

handler.register('GET', '/entity/*/databases', new HandlerDatabases());
