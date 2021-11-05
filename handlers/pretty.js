'use strict';

const handler = require('../handler.js');
const Logger = require('../logger.js');
const util = require('../util.js');

const OPTIONS = {
    log: new Logger('handler:pretty'),
    contentType: 'text/plain',
    inputData: {
        enabled: true,
        type: 'application/json',
    }
};

class HandlerPretty extends handler.Handler {

    constructor() {
        super(OPTIONS);
    }

    async process(ctx) {
        this.log.info('Pretty echo back');
        this.headEnd(ctx, 200, JSON.stringify(ctx.data, null, 4));
    }
}

handler.register('POST', '/pretty', new HandlerPretty());
