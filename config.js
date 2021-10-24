'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const util = require(__dirname + '/util.js');

const APP_DEFAULTS = {
    config: __dirname + '/config.json',
    dataDir: __dirname + '/data',
    handlerDirs: [ __dirname + '/handlers' ],
};

class Config extends EventEmitter {

    constructor() {
        super()
        this.options = {}
    }

    reload(options) {
        util.omerge(this.options, APP_DEFAULTS, options);
        if (this.options.config) {
            try {
                options = fs.readFileSync(this.options.config);
                options = JSON.parse(options);
                if (!util.isObject(options)) {
                    log.error('Invalid data in config file, using defaults');
                    return false;
                }
            }
            catch (e) {
                log.error(e);
                log.error('Failed to load config file, using defaults');
                return false;
            }
            util.omerge(this.options, APP_DEFAULTS, options);
        }

        this.emit('reload');
        return true;
    }
}

module.exports = new Config();

/* load logger after exporting module options to avoid circular issues */
const Logger = require(__dirname + '/logger.js');
const log = new Logger('config');
