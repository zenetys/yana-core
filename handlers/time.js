'use strict';

const handler = require('../handler.js');
const Logger = require('../logger.js');
const util = require('../util.js');

const OPTIONS = {
    log: new Logger('handler:time'),
    contentType: 'application/json',
    inputRules: {
        qs: {
            type: 'object',
            fields: {
                wait: { type: 'number' }
            }
        }
    },
};

class HandlerTime extends handler.Handler {

    constructor() {
        super(OPTIONS);
    }

    async process(ctx) {
        if (ctx.url.qs.wait) {
            this.log.info(`Wait ${ctx.url.qs.wait} ms`);
            await util.sleep(ctx.url.qs.wait);
        }
        this.log.info('Reply our time to the client');
        var data = { time: (new Date()).getTime() / 1000 };
        this.headEnd(ctx, 200, JSON.stringify(data));
    }
}

handler.register('GET', '/time', new HandlerTime());
