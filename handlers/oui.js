'use strict';

const cache = require('../cache.js');
const handler = require('../handler.js');
const Logger = require('../logger.js');
const util = require('../util.js');

const OPTIONS = {
    log: new Logger('handler:oui'),
    contentType: 'application/json',
    inputRules: {
        qs: {
            type: 'object',
            fields: {
                q: {
                    type: 'string',
                },
            },
        },
    },
};

class HandlerOui extends handler.Handler {

    constructor() {
        super(OPTIONS);
    }

    async process(ctx) {
        var ouiDb = cache.getOuiDb();
        var result;

        if (ctx.url.qs.q) {
            result = {};
            let q = ctx.url.qs.q.split(/[\s,;]+/);
            for (let i of q) {
                i = i.toLowerCase().replace(/\W/g, '');
                i = i.substr(0, 2) + ':' + i.substr(2, 2) + ':' + i.substr(4, 2);
                if (ouiDb[i])
                    result[i] = ouiDb[i];
            }
        }
        else
            result = ouiDb;

        this.headEnd(ctx, 200, JSON.stringify(result));
    }
}

handler.register('GET', '/oui', new HandlerOui());
