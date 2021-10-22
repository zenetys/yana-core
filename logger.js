'use strict';

const config = require(__dirname + '/config.js');
const util = require(__dirname + '/util.js');

const DEFAULTS = {
    verbose: 1,
    stack: true,
    logger: {},
    color: null, /* auto */
}

/* Make global module <options> point on <config.options.log>. Assume
 * neither <config.options> nor <config.options.log> will be reassigned. */
config.options.log = util.omerge({}, DEFAULTS, config.options.log)
const options = config.options.log;

/* color formating options */
const fmtOpenClose = [
    {
        ERROR: { open: '', close: '' },
        WARNING: { open: '', close: '' },
        INFO: { open: '', close: '' },
        DEBUG: { open: '', close: '' },
        DEBUG2: { open: '', close: '' },
        stack: { open: '', close: '' },
        dump: { open: '', close: '' },
    },
    {
        ERROR: { open: '\x1b[31m', close: '\x1b[0m' },
        WARNING: { open: '\x1b[33;2m', close: '\x1b[0m' },
        INFO: { open: '', close: '' },
        DEBUG: { open: '\x1b[37;2m', close: '\x1b[0m' },
        DEBUG2: { open: '\x1b[37;2m', close: '\x1b[0m' },
        stack: { open: '\x1b[37;2m', close: '\x1b[0m' },
        dump: { open: '\x1b[37;2m', close: '\x1b[0m' },
    },
];

/* minimum verbosity to print for a given severity */
const minVerbosity = {
    DEBUG2: 3,
    DEBUG: 2,
    INFO: 1,
    WARNING: 0,
    ERROR: 0,
};

/* return the current time in rfc3339 format */
function formatDate() {
    var now = new Date();
    var out = now.getFullYear() +
        '-' + (now.getMonth() + 1).toString().padStart(2, '0') +
        '-' + now.getDate().toString().padStart(2, '0') +
        'T' + now.getHours().toString().padStart(2, '0') +
        ':' + now.getMinutes().toString().padStart(2, '0') +
        ':' + now.getSeconds().toString().padStart(2, '0') +
        '.' + now.getMilliseconds().toString().padStart(3, '0');

    var tzOffset = now.getTimezoneOffset() * -1;
    if (tzOffset == 0)
        out += 'Z'
    else {
        let tzOffsetHours = Math.floor(tzOffset / 60);
        let tzOffsetMinutes = tzOffset % 60;
        out += (tzOffset >= 0 ? '+' : '-') +
            tzOffsetHours.toString().padStart(2, '0') + ':' +
            tzOffsetMinutes.toString().padStart(2, '0');
    }
    return out;
}

class Logger {

    constructor(name, prefix) {
        this.name = name;
        this.prefix = prefix;
    }

    /* duplicate the Logger instance with an optional new name and prefix */
    dup(name, prefix) {
        return new Logger(name || this.name, prefix || this.prefix);
    }

    /* Supported signatures:
     * - log(severity, ...args)
     * - log(severity, [...args,] err)
     * - log(severity, func)
     *
     * The "err" signature takes an Error object as value to print. In that
     * case the function prints the message property. When the stack option
     * is enabled, the whole Error object is dumped with console.error.
     * The "func" signature prints the value returned by the function.
     */
    log(severity, ...args) {
        if (this.getOption('verbose') < minVerbosity[severity])
            return false; /* skiped */

        if (typeof args[0] == 'function') {
            args = [ args[0]() ];
            if (args[0] === undefined)
                return false; /* skiped */
        }

        var err = undefined;
        if (args[args.length-1] instanceof Error) {
            err = args.splice(-1)[0];
            args.push(util.err2str(err));
        }

        let oc = this.getOpenClose();
        let intro = formatDate() + ' ' + oc[severity].open + severity +
             oc[severity].close + ' [' + this.name + '] ';
        if (this.prefix)
            intro += ((typeof this.prefix == 'function')
                ? this.prefix() : this.prefix) + ': ';

        process.stderr.write(intro);
        console.error(...args);
        if (err && err.stack && this.getOption('stack'))
            console.error(err);
        return true; /* printed */
    }

    dump(...args) {
        let oc = this.getOpenClose();
        process.stderr.write(oc.dump.open);
        console.error(...args);
        process.stderr.write(oc.dump.close);
    }

    error(...args) { return this.log('ERROR', ...args); }
    warning(...args) { return this.log('WARNING', ...args); }
    info(...args) { return this.log('INFO', ...args); }
    debug(...args) { return this.log('DEBUG', ...args); }
    debug2(...args) { return this.log('DEBUG2', ...args); }

    /* property: verbose, stack */
    getOption(property) {
        return (this.name &&
                options.logger[this.name] &&
                options.logger[this.name][property] != undefined)
            ? options.logger[this.name][property]
            : options[property];
    }

    getOpenClose() {
        if (options.color === null) /* auto */
            options.color = process.stdin.isTTY ? true : false;
        /* 0/1 indice in fmtOpenClose */
        return fmtOpenClose[(!!options.color + 0)];
    }
}

module.exports = Logger;
