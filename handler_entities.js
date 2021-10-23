'use strict';

const config = require(__dirname + '/config.js');
const Handler = require(__dirname + '/handler.js');
const Logger = require(__dirname + '/logger.js');
const util = require(__dirname + '/util.js');

const OPTIONS = {
    log: new Logger('handler:entities'),
    contentType: 'application/json',
};

class HandlerEntities extends Handler {

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

module.exports = HandlerEntities;
