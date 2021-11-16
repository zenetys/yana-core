'use strict';

const cache = require('../cache.js');
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

class HandlerDatabases extends handler.Handler {

    constructor() {
        super(OPTIONS);
    }

    async process(ctx) {
        var result = cache.getDbList(ctx.url.params[0]);
        if (result instanceof Error)
            return this.headEnd(ctx, result.code == 'ENOENT' ? 400 : 500);

        this.headEnd(ctx, 200, JSON.stringify(result));
    }
}

handler.register('GET', '/entity/*/databases', new HandlerDatabases());
