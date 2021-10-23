'use strict';

const Handler = require(__dirname + '/handler.js');
const Logger = require(__dirname + '/logger.js');
const util = require(__dirname + '/util.js');

const OPTIONS = {
    log: new Logger('handler:pretty'),
    contentType: 'text/plain',
    inputData: {
        enabled: true,
        type: 'application/json',
    }
};

class HandlerPretty extends Handler {

    constructor() {
        super(OPTIONS);
    }

    async process(ctx) {
        this.log.info('Pretty echo back')
        ctx.res.writeHead(200);
        ctx.res.end(JSON.stringify(ctx.data, null, 4));
    }
}

module.exports = HandlerPretty;
