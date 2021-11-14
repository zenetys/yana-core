'use strict';

/* const <cache> delayed after module.exports to handle circular dependency */
const config = require('./config.js');
const crypto = require('crypto');
const fs = require('fs');
const Logger = require('./logger.js');
const util = require('./util.js');
const log = new Logger('builder');

/* builders registration */

var BUILDERS = [];

function register(position, definition) {
    if (BUILDERS[position])
        throw Error(`Cannot register builder "${definition.comment}", ` +
            `position #${position} already taken`);
    BUILDERS[position] = definition;
}

/* Load builders, which fills <BUILDERS> because builder addons
 * register themselves by calling register(). */
function reload() {
    var files = [];
    BUILDERS = [];

    for (let dir of config.options.builderDirs) {
        try {
            files.push(... util.lsDirSync(dir, {
                lstat: true,
                apply: (out, d,n,s) => {
                    if (s.isFile() && n.substr(-3) == '.js')
                        out.push(d + '/' + n);
                }
            }));
        }
        catch (e) {
            log.error(e);
            log.error('Failed to list builders in ' + dir);
            return false;
        }
    }

    /* assume exceptions are handled by caller */
    for (let i of files) {
        log.debug('Load ' + i);
        delete require.cache[require.resolve(i)]; /* for reload */
        require(i);
    }
}

/* builder core */

function data(v, o) {
    return { _data: { v, o } };
}

function autoKv(x) {
    var out = '';
    if (util.isObject(x) || Array.isArray(x)) {
        for (let i in x) {
            if (out)
                out += '|';
            out += autoKv(x[i]);
        }
    }
    else
        out += x;
    return out;
}

function datalist(v, o, KvFn) {
    var Kv = KvFn ? KvFn(v) : autoKv(v);
    return { _datalist: { [`${o}|${Kv}`]: data(v, o) } };
}

function data2datalist(d, KvFn) {
    return datalist(dataValue(d), dataOrigin(d), KvFn);
}

function isData(x) {
    return util.isObject(x) && x._data;
}

function isDatalist(x) {
    return util.isObject(x) && x._datalist;
}

function dataOrigin(x) {
    if (!isData(x))
        throw Error('dataValue: invalid arguments, _data required');
    return x._data.o;
}

function dataValueEq(a, b) {
    if (!isData(a) || !isData(b))
        throw Error('dataValueEq: invalid arguments, two _data required');
    return util.eq(a._data.v, b._data.v);
}

function dataValue(x) {
    if (!isData(x))
        throw Error('dataValue: invalid arguments, _data required');
    return x._data.v;
}

/* append datalist <b> into datalist <a> */
function datalistAdd(a, b) {
    if (!isDatalist(a) || !isDatalist(b))
        throw Error('datalistAdd: invalid arguments, two _datalist required');
    /* omerge() does clone and thus is slower, so far not cloning here has
     * not been an issue. */
    //util.omerge(a, b);
    for (let bk in b._datalist)
        a._datalist[bk] = b._datalist[bk];
}

/**
 * Options are evaluated in the following order:
 *
 * - filter:
 *      Array filter callback that gets called for each datalist element. If
 *      the callback returns true (false), the element is included (excluded).
 * - sort:
 *      Standard array comparison function to sort entries. Arguments passed
 *      to the callback are datalist elements.
 * - uniq:
 *      Callback function that gets called for each datalit element. The value
 *      it returns is used as uniqueness criteria value.
 * - format:
 *      Callback function used to format datalist elements. By default the
 *      value fiels of the element is returned.
 * - fn:
 *      Last chance callback function that can be used to modify the resulting
 *      array. The array gets passed as argument. By default, if the format
 *      option is not canceled, the array will be made of datalist values.
 */
function datalistValues(x, opt) {
    if (!isDatalist(x))
        throw Error('datalistValues: invalid arguments, _datalist required');
    opt ||= {};
    var out = Object.values(x._datalist);
    if (opt.filter)
        out = out.filter(opt.filter);
    if (opt.sort)
        out.sort(opt.sort);
    if (opt.uniq) {
        let kfn = (typeof opt.uniq == 'function')
            ? opt.uniq : (e) => autoKv(dataValue(e));
        let u = {};
        for (let e of out) {
            let kv = kfn(e);
            if (u[kv] === undefined)
                u[kv] = e;
        }
        out = Object.values(u);
    }
    if (opt.format !== false)
        out = out.map(opt.format || ((d) => dataValue(d)));
    if (opt.fn)
        out = opt.fn(out);
    return out;
}

function makeCmpOriginPrio(spec /* [ 'match1', 'match2', ... ] */) {
    return util.makeCmpFn((d) => {
        let o = dataOrigin(d);
        for (let i = 0; i < spec.length; i++) {
            // FIXME: double lowercase
            if (o.toLowerCase().indexOf(spec[i].toLowerCase()) > -1)
                return i;
        }
        return spec.length;
    });
}

function makeCmpDataIp() {
    return util.makeCmpFn((d) => dataValue(d), undefined, util.cmpIntSplit);
}

const DEFAULT_BUILD_OPTS = {
    genid: (path) => crypto.randomUUID(),
}

class Build {
    constructor(ndb, opts) {
        opts = Object.assign({}, DEFAULT_BUILD_OPTS, opts);
        this.log = log.dup({ prefix: opts.lid });
        this.genid = opts.genid;
        this.ndb = ndb || {}; /* nscan database */
        this.db = {}; /* resulting database */
        this.toResolve = []; /* conflicts marked for analysis */
    }
}

Build.prototype.ntableForEach1 = function (table, ntableDeviceKNum /* falsy to disable */, fn) {
    if (!this.ndb[table])
        return;
    if (ntableDeviceKNum && ntableDeviceKNum !== 1)
        throw Error('ntableForEach1: expected ntableDeviceKNum 1 or falsy to disable');
    var did; /* undefined */
    for (let k1 in this.ndb[table]) {
        if (ntableDeviceKNum)
            did = this.addDevice('nscan', k1, table);
        this.log.debug3(`ntableForEach1: on table ${table}: k1=${k1}`);
        fn(did, k1, this.ndb[table][k1], table);
    }
}

Build.prototype.ntableForEach2 = function (table, ntableDeviceKNum /* falsy to disable */, fn) {
    if (!this.ndb[table])
        return;
    if (ntableDeviceKNum && ntableDeviceKNum !== 1 && ntableDeviceKNum !== 2)
        throw Error('ntableForEach1: expected ntableDeviceKNum 1 or 2, or falsy to disable');
    for (let k1 in this.ndb[table]) {
        let did = undefined;
        for (let k2 in this.ndb[table][k1]) {
            if (ntableDeviceKNum)
                did = this.addDevice('nscan', ntableDeviceKNum == 1 ? k1 : k2, table);
            this.log.debug3(`ntableForEach2: on table ${table}: k1=${k1}, k2=${k2}`);
            fn(did, k1, k2, this.ndb[table][k1][k2], table);
        }
    }
}

/* same as this.toResolve.push(...) but with logging */
Build.prototype.addToResolve = function (data) {
    this.log.warning(`toResolve: ${data.comment ? data.comment : JSON.stringify(data)}, mark for later analysis`);
    this.toResolve.push(data);
}

Build.prototype.add = function (db, path, /* optional */ value, opt) {
    opt ||= {};
    this.db[db] ||= {};
    var o = this.db[db];
    var i;

    /* assume <path> type array */
    if (path.length < 1)
        throw Error(`add: invalid path argument, need at least one element`);

    for (i = 0; i < path.length - 1; i++) {
        if (path[i] === undefined)
            throw Error(`add: ${db}.${path.join('.')}, undefined path component #${i}`);

        if (o[path[i]] === undefined)
            o[path[i]] = {};
        else if (!util.isObject(o[path[i]]))
            throw Error(`add: ${db}.${path.join('.')}, not an object at ${path[i]}`);
        o = o[path[i]];
    }

    if (path[i] === undefined)
        throw Error(`add: ${db}.${path.join('.')}, undefined path component #${path.length}`);

    if (value !== undefined) {
        if (o[path[i]] === undefined)
            o[path[i]] = value;
        else if (!opt.onConflict || !opt.onConflict(o, path[i], value, o[path[i]]))
            throw Error(`add: cannot set ${db}.${path.join('.')} to ${JSON.stringify(value)}, ` +
                        `unresolved conflict with ${JSON.stringify(o[path[i]])}`);
    }
    else if (o[path[i]] === undefined && opt.onNotFound)
        o[path[i]] = opt.onNotFound();
    return o[path[i]];
}

Build.prototype.addDevice = function (originType, originKey, originTable) {
    var did = this.getOrGenID('ualias', ['device', originType, originKey]);
    this.addImmutableData('device', [did, 'id'], data(did, originTable));
    return did;
}

/* unique alias */
Build.prototype.ualias = function (path, value) {
    return this.add('ualias', path, value, {
        onConflict: (o, key, value, current) => {
            if (util.eq(o[key], value))
                return true; /* no issue */
            this.addToResolve({ add: { db: 'ualias', path, value, current }, comment: `cannot set ` +
                `ualias.${path.join('.')} to ${value}, conflict with ${current}` });
            return true; /* later analysis */
        },
    });
}

/* many alias */
Build.prototype.malias = function (path, value) {
    var kvalue = typeof value == 'object'
        ? util.stringifySortedKeys(value)
        : value.toString();
    return this.set('malias', path.concat(kvalue), value);
}

/* set data without overwrite */
Build.prototype.addImmutableData = function (db, path, data) {
    return this.add(db, path, data, {
        /* only value matters, ignore origin and potential other metadata */
        onConflict: (o, k, v) => dataValueEq(o[k], v),
    });
}

/* set value with overwrite */
Build.prototype.set = function (db, path, value) {
    return this.add(db, path, value, {
        onConflict: (o, k, v) => { o[k] = v; return true; },
    });
}

Build.prototype.get = Build.prototype.add;

Build.prototype.getOrGenID = function (db, path) {
    return this.add(db, path, undefined, {
        onNotFound: () => this.genid(path),
    });
}

/* append to a datalist */
Build.prototype.addDatalist = function (db, path, datalist) {
    return this.add(db, path, datalist, {
        onConflict: (o, k, v) => { datalistAdd(o[k], v); return true; },
    });
}

function simplify(o, spec, /* internal */ path) {
    spec ||= {};
    path ||= [ '$' ];

    var out; /* do not modify in place */

    if (isDatalist(o))
        out = datalistValues(o, spec['@']);
    else if (isData(o))
        out = dataValue(o);
    else if (util.isObject(o) || Array.isArray(o)) {
        out = {};
        for (let i in o) {
            let iSpec = util.omerge({}, spec['*'], spec[i]);
            out[i] = simplify(o[i], iSpec, path.concat(i));
        }
    }
    else
        out = o;

    return out;
}

function runBuilders(ndb, opts) {
    var ctx = new Build(ndb, opts);
    var msGlobal = new Date();

    ctx.result = BUILDERS.every((b, ib) => {
        let bres;

        ctx.log.info(`Builder #${ib}, ${b.comment}`);
        let ms = new Date();
        try { bres = b.fn(ctx, b); }
        catch (e) { bres = e; }
        ms = new Date() - ms;

        if (!bres)
            bres = Error('returned a falsy value');
        if (bres instanceof Error) {
            ctx.log.error(`Builder #${ib} failed.`, bres);
            return false;
        }

        ctx.log.info(`Builder #${ib} success, time=${ms}ms`);
        return true;
    });

    if (ctx.result) {
        msGlobal = new Date() - msGlobal;
        ctx.log.info(`Build success, time=${msGlobal}ms`);
    }
    else
        ctx.log.error('Build failed');

    return ctx;
}

/* constants for normalization */

const IF_DUPLEX_STATUS_UNKNOWN = 1;
const IF_DUPLEX_STATUS_HALF = 2;
const IF_DUPLEX_STATUS_FULL = 3;
const IF_DUPLEX_STATUS = {
    [IF_DUPLEX_STATUS_UNKNOWN]: 'unknown',
    [IF_DUPLEX_STATUS_HALF]: 'half',
    [IF_DUPLEX_STATUS_FULL]: 'full',
};

const IF_STATUS_UP = 1;
const IF_STATUS_DOWN = 2;
const IF_STATUS_TESTING = 3;
const IF_STATUS_UNKNOWN = 4;
const IF_STATUS_DORMANT = 5;
const IF_STATUS_NOT_PRESENT = 6;
const IF_STATUS_LOWER_LAYER_DOWN = 7;
const IF_STATUS = {
  [IF_STATUS_UP]: 'up',
  [IF_STATUS_DOWN]: 'down',
  [IF_STATUS_TESTING]: 'testing',
  [IF_STATUS_UNKNOWN]: 'unknown',
  [IF_STATUS_DORMANT]: 'dormant',
  [IF_STATUS_NOT_PRESENT]: 'notPresent',
  [IF_STATUS_LOWER_LAYER_DOWN]: 'lowerLayerDown',
};

const SW_PORT_MODE_TRUNK = 1;
const SW_PORT_MODE_ACCESS = 2;
const SW_PORT_MODE_DESIRABLE_TRUNK = 3;
const SW_PORT_MODE_AUTO = 4;
const SW_PORT_MODE_TRUNK_NO_NEGO = 5;
const SW_PORT_MODE_GENERAL = 6;
const SW_PORT_MODE_CUSTOMER = 7;
const SW_PORT_MODE_DOT1Q_LIKE_TRUNK = 8;
const SW_PORT_MODE_DOT1Q_LIKE_ACCESS = 9;
const SW_PORT_MODE_DOT1Q_LIKE_GENERAL = 10;
const SW_PORT_MODE_FEX = 11;
const SW_PORT_MODE = {
    [SW_PORT_MODE_TRUNK]: 'trunk',
    [SW_PORT_MODE_ACCESS]: 'access',
    [SW_PORT_MODE_DESIRABLE_TRUNK]: 'desirableTrunk',
    [SW_PORT_MODE_AUTO]: 'auto',
    [SW_PORT_MODE_TRUNK_NO_NEGO]: 'trunkNoNegociate',
    [SW_PORT_MODE_GENERAL]: 'general',
    [SW_PORT_MODE_CUSTOMER]: 'customer',
    [SW_PORT_MODE_DOT1Q_LIKE_TRUNK]: 'dot1qLikeTrunk',
    [SW_PORT_MODE_DOT1Q_LIKE_ACCESS]: 'dot1qLikeAccess',
    [SW_PORT_MODE_DOT1Q_LIKE_GENERAL]: 'dot1qLikeGeneral',
    [SW_PORT_MODE_FEX]: 'fex',
};

const SW_PORT_STATUS_TRUNKING = 1;
const SW_PORT_STATUS_NOT_TRUNKING = 2;
const SW_PORT_STATUS = {
    [SW_PORT_STATUS_TRUNKING]: 'trunking',
    [SW_PORT_STATUS_NOT_TRUNKING]: 'notTrunking',
};

/* utility functions */

function decOidName(oid, opt) {
    opt = Object.assign({}, { /* defaults */ maxTries: 1 }, opt);

    var saveOid = oid;
    var fallback = () => opt.fallback === undefined ? saveOid : opt.fallback;
    var snmpOidDb = cache.getSnmpOidDb();
    var tries = 0;

    while (oid.length > 0) {
        if (snmpOidDb[oid])
            return snmpOidDb[oid];

        tries++;
        if (opt.maxTries && tries >= opt.maxTries)
            break;

        let lastDot = oid.lastIndexOf('.');
        if (lastDot == -1)
            break;

        oid = oid.substr(0, lastDot);
        if (opt.downTo && (oid.indexOf(opt.downTo) != 0 ||
                           oid.length <= opt.downTo.length))
            break;
    }

    return fallback();
}


/* exports */

module.exports = {
    register,
    reload,
    data,
    data2datalist,
    dataOrigin,
    dataValue,
    dataValueEq,
    datalist,
    datalistAdd,
    datalistValues,
    isData,
    isDatalist,
    makeCmpDataIp,
    makeCmpOriginPrio,
    simplify,
    runBuilders,

    IF_DUPLEX_STATUS_UNKNOWN,
    IF_DUPLEX_STATUS_HALF,
    IF_DUPLEX_STATUS_FULL,
    IF_DUPLEX_STATUS,
    IF_STATUS_UP,
    IF_STATUS_DOWN,
    IF_STATUS_TESTING,
    IF_STATUS_UNKNOWN,
    IF_STATUS_DORMANT,
    IF_STATUS_NOT_PRESENT,
    IF_STATUS_LOWER_LAYER_DOWN,
    IF_STATUS,
    SW_PORT_MODE_TRUNK,
    SW_PORT_MODE_ACCESS,
    SW_PORT_MODE_DESIRABLE_TRUNK,
    SW_PORT_MODE_AUTO,
    SW_PORT_MODE_TRUNK_NO_NEGO,
    SW_PORT_MODE_GENERAL,
    SW_PORT_MODE_CUSTOMER,
    SW_PORT_MODE_DOT1Q_LIKE_TRUNK,
    SW_PORT_MODE_DOT1Q_LIKE_ACCESS,
    SW_PORT_MODE_DOT1Q_LIKE_GENERAL,
    SW_PORT_MODE_FEX,
    SW_PORT_MODE,
    SW_PORT_STATUS_TRUNKING,
    SW_PORT_STATUS_NOT_TRUNKING,
    SW_PORT_STATUS,

    decOidName,
    Build
};

/* circular dependency workaround */
const cache = require('./cache.js');
