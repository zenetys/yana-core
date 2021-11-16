'use strict';

const cache = require('../cache.js');
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
        var result = cache.getEntityList();
        if (result instanceof Error)
            return this.headEnd(ctx, 500);

        this.headEnd(ctx, 200, JSON.stringify(result));
    }
}

handler.register('GET', '/entities', new HandlerEntities());
