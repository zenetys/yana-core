'use strict';

const config = require('../config.js');
const handler = require('../handler.js');
const Logger = require('../logger.js');
const util = require('../util.js');

const OPTIONS = {
    log: new Logger('handler:entities'),
    contentType: 'application/json',
};

class HandlerEntities extends handler.Handler {

    constructor() {
        super(OPTIONS);
    }

    async process(ctx) {
        var entities;

        try {
            entities = util.lsDirSync(config.options.dataDir, { lstat: true,
                filter: (d,n,s) => s.isDirectory() && n.substr(0, 1) != '.' });
        }
        catch (e) {
            this.log.error(e);
            this.log.error('Failed to list entities');
            ctx.res.writeHead(500);
            return;
        }

        entities.sort();
        ctx.res.writeHead(200);
        ctx.res.end(JSON.stringify(entities));
    }
}

handler.register('GET', '/entities', new HandlerEntities());
