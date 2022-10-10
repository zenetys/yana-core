'use strict';

const config = require('./config.js');
const util = require('./util.js');

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
const fmtColor = [
    {
        ERROR: {},
        WARNING: {},
        INFO: {},
        DEBUG: {},
        DEBUG2: {},
        DEBUG3: {},
        DEBUG4: {},
        stack: {},
        dump: {},
    },
    {
        ERROR: { c1: '\x1b[31m' },
        WARNING: { c1: '\x1b[33;2m' },
        INFO: {},
        DEBUG: { c1: '\x1b[37;2m' },
        DEBUG2: { c1: '\x1b[37;2m' },
        DEBUG3: { c1: '\x1b[37;2m' },
        DEBUG4: { c1: '\x1b[37;2m', c2: '\x1b[0;90m' },
        stack: { c1: '\x1b[37;2m' },
        dump: { c1: '\x1b[37;2m' },
    },
];

const creset = '\x1b[0m';

function consoleColor(color, ...args) {
    if (color) {
        process.stderr.write(color);
        process.stderr.write(args.map((a) =>
            typeof a == 'string' ? a : util.inspect(a)).join(' '));
        process.stderr.write(creset + '\n');
    }
    else
        console.error(...args);
}

/* minimum verbosity to print for a given severity */
const minVerbosity = {
    DEBUG4: 5,
    DEBUG3: 4,
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
    dup(options) {
        return new Logger(options.name || this.name,
            options.prefix || this.prefix);
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

        const color = this.getFmtColor(severity);
        let intro = formatDate() + ' ' + (color.c1 ?
            (color.c1 + severity + creset) : severity) +
            ' [' + this.name + '] ';
        if (this.prefix)
            intro += ((typeof this.prefix == 'function')
                ? this.prefix() : this.prefix) + ': ';

        process.stderr.write(intro);
        consoleColor(color.c2, ...args);
        if (err && err.stack && this.getOption('stack'))
            console.error(err);
        return true; /* printed */
    }

    dump(...args) {
        const color = this.getFmtColor('dump');
        consoleColor(color.c1, ...args);
    }

    error(...args) { return this.log('ERROR', ...args); }
    warning(...args) { return this.log('WARNING', ...args); }
    info(...args) { return this.log('INFO', ...args); }
    debug(...args) { return this.log('DEBUG', ...args); }
    debug2(...args) { return this.log('DEBUG2', ...args); }
    debug3(...args) { return this.log('DEBUG3', ...args); }
    debug4(...args) { return this.log('DEBUG4', ...args); }

    /* property: verbose, stack */
    getOption(property) {
        return (this.name &&
                options.logger[this.name] &&
                options.logger[this.name][property] != undefined)
            ? options.logger[this.name][property]
            : options[property];
    }

    getFmtColor(cid) {
        if (options.color === null) /* auto */
            options.color = process.stdin.isTTY ? true : false;
        /* 0/1 indice in fmtColor */
        return fmtColor[(!!options.color + 0)][cid];
    }
}

module.exports = Logger;
