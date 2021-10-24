'use strict';

const handler = require('./../handler.js');
const Logger = require(__dirname + '/logger.js');
const util = require(__dirname + '/util.js');

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
        this.log.info('Reply our time to the client')
        var data = { time: (new Date()).getTime() / 1000 };
        ctx.res.writeHead(200);
        ctx.res.end(JSON.stringify(data));
    }
}

handler.register('GET', '/time', new HandlerTime());
