'use strict';

const util = require('./util.js');
const EventEmitter = require('events');
const fs = require('fs');

const APP_DEFAULTS = {
    config: __dirname + '/config.json',
    builderDirs: [ __dirname + '/builders' ],
    dataDir: __dirname + '/data',
    handlerDirs: [ __dirname + '/handlers' ],
    parserDirs: [ __dirname + '/parsers' ],
    snmpOidFile: __dirname + '/snmp-oid.json',
};

class Config extends EventEmitter {

    constructor() {
        super()
        this.options = {}
    }

    reload(manualOptions) {
        util.omerge(this.options, APP_DEFAULTS, manualOptions);

        if (this.options.config) {
            let configOptions;
            try {
                configOptions = fs.readFileSync(this.options.config);
                configOptions = JSON.parse(configOptions);
                if (!util.isObject(configOptions)) {
                    log.error('Invalid data in config file, using defaults');
                    return false;
                }
            }
            catch (e) {
                log.error(e);
                log.error('Failed to load config file, using defaults');
                return false;
            }

            util.omerge(this.options, APP_DEFAULTS, configOptions,
                manualOptions);
        }

        this.emit('reload');
        return true;
    }
}

module.exports = new Config();

/* load logger after exporting module options to avoid circular issues */
const Logger = require('./logger.js');
const log = new Logger('config');
