"use strict";

const crypto = require('crypto');
const fs = require('fs');
const util = require('util');

function bufArr2str(bufArray, maxBytes, encoding) {
    if (maxBytes === undefined)
        return bufArray.reduce((str, buf) => str += buf.toString(encoding), '');

    var out = '';
    var copiedBytes = 0;
    for (let b of bufArray) {
        let neededBytes = Math.min(b.length, maxBytes - copiedBytes);
        out += b.toString(encoding, 0, neededBytes);
        copiedBytes += neededBytes;
        if (copiedBytes >= maxBytes)
            break;
    }
    return out;
}

function bufArrLen(bufArray) {
    return bufArray.reduce((len, buf) => len += buf.length, 0);
}

function checkData(x, r, path = '$') {
    var out = { parsed: x };
    var e = (msg) => { out.error = msg; return out; };

    if (!r || (r.nullable && x === null))
        return out;

    if (r.type == 'string') {
        if (typeof x != 'string')
            return e(`string required at ${path}`);
    }
    else if (r.type == 'number') {
        if (typeof x != 'number' && isNaN(x)) /* accept number as string */
            return e(`number required at ${path}`);
    }
    else if (r.type == 'boolean') {
        if (typeof x != 'boolean')
            return e(`boolean required at ${path}`);
    }
    else if (r.type == 'date_string') {
        out.parsed = new Date(x);
        if (isNaN(out.parsed.getTime()))
            return e(`date string required at ${path}`);
    }
    else if (r.type == 'object') {
        if (!isObject(x))
            return e(`object required at ${path}`);
        if (r.fields) {
            for (let f in r.fields) {
                if (x[f] === undefined) {
                    if (r.fields[f].required)
                        return e(`value required at ${path}.${f}`);
                }
                else {
                    let c = checkData(x[f], r.fields[f], `${path}.${f}`);
                    if (c.error)
                        return e(c.error);
                    out.parsed[f] = c.parsed;
                }
            }
        }
    }
    else if (r.type == 'array') {
        if (!Array.isArray(x))
            return e(`array required at ${path}`);
        if (r.min && x.length < r.min)
            return e(`array length >= ${r.min} required at ${path}`);
        if (r.max && x.length > r.max)
            return e(`array length <= ${r.max} required at ${path}`);
        if (r.elems) {
            for (let i = 0; i < x.length; i++) {
                let c = checkData(x[i], r.elems, `${path}[${i}]`);
                if (c.error)
                    return e(c.error);
                out.parsed[i] = c.parsed;
            }
        }
    }

    if (r.check && !r.check(x))
        return e(`invalid value at ${path}`);

    return out;
}

function clone(x, strict = true) {
    if (Array.isArray(x)) {
        let out = x.constructor(x.length);
        x.forEach((e, i) => { out[i] = clone(e); });
        return out;
    }

    if (typeof x == 'object' && x !== null) {
        if (x.constructor.name == 'Boolean' ||
            x.constructor.name == 'Date' ||
            x.constructor.name == 'Number' ||
            x.constructor.name == 'RegExp' ||
            x.constructor.name == 'String')
            return new x.constructor(x.valueOf());

        if (x.constructor.name == 'Object') {
            let out = {};
            for (let k in x)
                out[k] = clone(x[k]);
            /* symbols are not enumerated in for ... in loops */
            for (let k of Object.getOwnPropertySymbols(x))
                out[k] = clone(x[k]);
            return out;
        }

        if (strict)
            throw Error('clone: unsupported object ' + x.constructor.name);
    }

    return x;
}

function cmpDefault(a, b) {
    return a > b ? 1 : (a < b ? -1 : 0);
}

function cmpIntSplit(a, b) {
    a = a.split(/[^0-9]+/);
    b = b.split(/[^0-9]+/);

    for (let i = 0, len = Math.max(a.length, b.length); i < len; i++) {
        a[i] *= 1; /* type number */
        b[i] *= 1; /* type number */
        if (isNaN(a[i])) {
            if (!isNaN(b[i]))
                return -1;
        }
        else if (isNaN(b[i]))
            return 1;
        else {
            let cmp = a[i] - b[i];
            if (cmp != 0)
                return cmp;
        }
    }
    return 0;
}

/* Recursively test if two objects are equivalents. This simple implementation
 * is enought for primitive data types, standard objects, arrays.
 * Credits to Jean Vincent (uiteoi), https://stackoverflow.com/a/6713782 */
function eq(x, y) {
    if (x === y)
        return true;
    if (!(x instanceof Object) || !(y instanceof Object))
        return false;
    if (x.constructor !== y.constructor)
        return false;
    for (let p in x ) {
        if (!x.hasOwnProperty(p))
            continue;
        if (!y.hasOwnProperty(p))
            return false;
        if (x[p] === y[p])
            continue;
        if (typeof x[p] !== 'object')
            return false;
        if (!eq(x[p], y[p]))
            return false;
    }
    for (let p in y) {
        if (y.hasOwnProperty(p) && !x.hasOwnProperty(p))
            return false;
    }
    return true;
}

function err2str(err) {
    var out = err.toString();
    /*for (let i in err)
        out += `, ${i}: ${err[i]}`;*/
    return out;
}

function first(x) {
    return Array.isArray(x) ? x[0] : x;
}

const HN_DEFAULTS = {
    multiple: 1000,
    precision: 2,
    fixed: true,
    inter: '',
    uom: '',
};

function humanNumber(number, options) {
    options = Object.assign({}, HN_DEFAULTS, options);
    var minus, prefix, neutral, i;

    if (typeof(number) != 'number')
        number = new Number(number);
    if (isNaN(number))
        return null;

    if (number >= 0)
        minus = '';
    else {
        number = Math.abs(number);
        minus = '-';
    }

    if (options.multiple == 1024) {
        prefix = ['', 'Ki', 'Mi', 'Gi', 'Ti', 'Pi'];
        neutral = 0;
    }
    else {
        prefix = ['n', 'µ', 'm', '', 'k', 'M', 'G', 'T', 'P'];
        neutral = 3;
    }

    /* index in prefix */
    i = neutral;

    if (options.multiple != 0) {
        while (number >= options.multiple && i++ < prefix.length - 1)
            number /= options.multiple;
        if (i == neutral) {
            while (number != 0 && i-- > 0 && number < 1)
                number *= options.multiple;
        }
    }
    number = options.fixed
        ? number.toFixed(options.precision)
        : number.toPrecision(options.precision);
    return minus + number + options.inter + prefix[i] + options.uom;
}

function ifNot(value1, value2) {
    return value1 ? value1 : value2;
}

function isObject(value) {
    return value !== null && typeof value == 'object' &&
        value.constructor === Object;
}

/**
 * List the content of a directory (synchronous).
 *
 * @param dir Path to the directory to list.
 * @param options Object holding filtering options:
 *  - [l]stat: If true performs a [l]stat on the entry
 *  - filter: Callback allowing to filter entries to return. The callback
 *      takes 3 arguments: the directory, the name of the entry and the (l)stat
 *      object associated to that entry depending on the (l)stat option. The
 *      stat argument will be undefined if the (l)stat option is not enabled.
 *      The entry callback must return true to accept an entry.
 *  - apply: Callback function that can be used to filter or modify elements.
 *      It takes 4 arguments. The first argument is the output array to push
 *      into in order to keep the element. The other 3 arguments are the same
 *      as for the filter callback.
 *
 * If both filter and apply options are used, the filter callback is executed
 * before the apply callback.
 *
 * @throws Error as thrown by fs.readdirSync() or fs.[l]statSync().
 * @return The list of entries found in the directory and matching the options.
 */
function lsDirSync(dir, options) {
    if (!options)
        options = {};

    var ls = fs.readdirSync(dir);

    if (options.filter || options.apply) {
        ls = ls.reduce((out, child) => {
            let entry = dir + '/' + child;
            let st = undefined;

            if (options.stat)
                st = fs.statSync(entry);
            else if (options.lstat)
                st = fs.lstatSync(entry);

            if (options.filter && options.filter(dir, child, st))
                out.push(child);
            if (options.apply)
                options.apply(out, dir, child, st);
            return out;
        }, /* initial reduced out */ []);
    }

    return ls;
}

function makeCmpFn(fn, asc /* -1 or 1 */, cmpFn) {
    cmpFn ||= cmpDefault;
    return (a, b) => cmpFn(fn(a), fn(b)) * (asc || 1);
}

function makeCmpKey(key, asc /* -1 or 1 */, cmpFn) {
    cmpFn ||= cmpDefault;
    return (a, b) => cmpFn(a[key], b[key]) * (asc || 1);
}

function makeCmpMultiFn(spec /* [ { asc: 1 or -1, fn: <func(a,b)> }, ... ] */) {
    return (a, b) => {
        for (let s of spec) {
            let cmp = s.fn(a, b) * (s.asc || 1);
            if (cmp != 0)
                return cmp;
        }
        return 0;
    }
}

function oempty(o) {
    for (let i in o)
            return false;
    return true;
}

function oget(o, path, cb) {
    for (let i = 0; i < path.length; i++) {
        if (!isObject(o))
            return undefined;
        o = o[path[i]];
    }
    if (cb)
        cb(o, path);
    return o;
}

function ogroup(o, ...groupFn) {
    var out = {};
    for (let k in o) {
        let group = groupFn.map((fn) => fn(k, o[k]))
        opush(out, group, o[k]);
    }
    return out;
}

function okeys(o, keys) {
    var out = {};
    for (let k of keys) {
        if (o.hasOwnProperty(k))
            out[k] = o[k];
    }
    return out;
}

function omatch(o, search, testFn) {
    testFn ||= (what, where) => where.toString().toLowerCase()
        .indexOf(what.toLowerCase()) > -1;
    var result = false;

    owalk(o, (io, path) => {
        if (Array.isArray(io)) {
            for (let e of io) {
                if (omatch(e, search, testFn)) {
                    result = true;
                    return false; /* stop */
                }
            }
        }
        if (io !== undefined && typeof io != 'object' &&
            typeof io != 'function' && testFn(search, io)) {
            result = true;
            return false; /* stop */
        }
        return true; /* continue */
    });
    return result;
}

function omerge(...o) {
    function _(o1 = {}, o2 = {}) {
        for (let k of Object.keys(o2)) {
            if (isObject(o1[k]) && isObject(o2[k]))
                _(o1[k], o2[k]);
            else
                o1[k] = clone(o2[k], false);
        }
        return o1;
    }

    if (o.length < 2)
        throw Error('omerge requires at least two arguments');
    if (!isObject(o[0]))
        throw Error('omerge operand #0 must be an object');

    var out = o[0];

    for (let i = 1; i < o.length; i++) {
        if (o[i] === undefined || o[i] === null)
            o[i] = {};
        else if (!isObject(o[i]))
            throw Error(`omerge operand #${i} must be an object`);
        out = _(out, o[i]);
    }
    return out;
}

function orm(o, path) {
    if (path.length < 1)
        throw Error(`orm: invalid path, need at least one element`);
    var root = o;
    var i;
    for (i = 0; i < path.length - 1; i++) {
        if (path[i] === undefined || /* we could throw on this one */
            !o[path[i]] ||
            !isObject(o[path[i]]))
            return;
        o = o[path[i]];
    }
    delete o[path[i]];
    if (oempty(o) && path.length > 1)
        orm(root, path.slice(0,-1));
}

function opush(o, path, v) {
    var x = (oget(o, path) || []);
    x.push(v);
    oset(o, path, x);
}

function oset(o, path, value) {
    var i;
    for (i = 0; i < path.length -1; i++) {
        if (!isObject(o[path[i]]))
            o[path[i]] = {}; /* may override */
        o = o[path[i]];
    }
    o[path[i]] = value; /* may override */
    return o[path[i]]; /* value */
}

/* Walk recursively on an object, calling a callback function on each node.
 * Note: this function does not traverse arrays, only objects.
 *
 * The callback takes as argument the current value and the path as array:
 *   fn(<currentObject>, <path[]>) => return true | false | number
 *
 * the callback return value is interpreted as follows:
 * - true: continue walking,
 * - false or 0: stop walking immediately,
 * - n: continue next iteration at depth n.
 *
 * If the callback return a number > path.length, the walk continues.
 */
function owalk(o, cb, /* internal */ path) {
    path ||= [];
    var ret = cb(o, path) || 0;
    if (ret !== true && ret <= path.length)
        return ret;
    if (isObject(o)) {
        for (let i in o) {
            let oret = owalk(o[i], cb, path.concat(i));
            if (oret === true)
                continue;
            if (oret <= path.length)
                return oret;
        }
    }
    return true;
}

class Ranges {
    constructor(ranges) {
        if (ranges) {
            this.ranges = ranges.slice(0, -1);
            if (ranges.length > 0) {
                let x = ranges.slice(-1)[0];
                this.start = x.from;
                this.last = x.to;
            }
        }
        else {
            this.ranges = [];
            this.start = undefined;
            this.last = undefined;
        }
        return this;
    }
    add(int) {
        if (this.last === undefined) {
            this.start = int;
        }
        else {
            let diff = int - this.last;
            if (diff <= 0)
                throw Error('Ranges.add: value must be greater than previous');
            if (diff > 1) {
                this.ranges.push({ from: this.start, to: this.last });
                this.start = int;
            }
        }
        this.last = int;
        return this;
    }
    get() {
        var out = [...this.ranges];
        if (this.last !== undefined) /* so is this.start */
            out.push({ from: this.start, to: this.last });
        return out;
    }
    remove(int) {
        let done = false;
        for (let i = 0; i < this.ranges.length; i++) {
            if (int < this.ranges[i].from)
                break;
            if (int == this.ranges[i].from) {
                if (this.ranges[i].to == this.ranges[i].from) {
                    this.ranges.splice(i, 1);
                    done = true;
                    break;
                }
                else {
                    this.ranges[i].from++;
                    done = true;
                    break;
                }
            }
            else if (int < this.ranges[i].to) /* && > this.from */ {
                this.ranges.splice(i, 1,
                    { from: this.ranges[i].from, to: int-1 },
                    { from: int+1, to: this.ranges[i].to });
                done = true;
                break;
            }
            else if (int == this.ranges[i].to) {
                this.ranges[i].to--;
                done = true;
                break;
            }
        }
        if (!done && this.last !== undefined) { /* so is this.start */
            if (int == this.start) {
                if (this.last == this.start) {
                    this.start = undefined;
                    this.last = undefined;
                }
                else {
                    this.start++;
                }
            }
            else if (int > this.start) {
                if (int < this.last) {
                    this.ranges.push({ from: this.start, to: int-1 });
                    this.start = int+1;
                }
                else if (int == this.last)
                    this.last--;
            }
        }
        return this;
    }
    toString(separator = ',') {
        var ranges = this.get();
        return ranges.reduce((r, i) => {
            r.push(i.from == i.to ? i.from : `${i.from}-${i.to}`);
            return r;
        }, []).join(separator);
    }
    static fromArray(a) {
        var r = new Ranges();
        for (let i of a)
            r.add(i);
        return r;
    }
}

function ranstr(bytes = 16) {
    return crypto.randomBytes(bytes).toString('hex');
}

function safePromise(promise) {
    return promise
        .then(result => [ null, result ])
        .catch(err => [ err, null ]);
}

function sha256(data) {
    var h = crypto.createHash('sha256');
    if (Array.isArray(data))
        data.forEach((d) => h.update(d));
    else
        h.update(data);
    return h.digest('hex');
}

function sleep(ms) {
    return new Promise(function (resolve) {
        return setTimeout(resolve, ms)
    })
}

function stringifySortedKeys(value, space) {
    function replacer(k,v) {
        if (isObject(v))
            v = Object.keys(v).sort().reduce(
                    (r, k) => { r[k] = v[k]; return r; },
                    {});
        return v;
    }
    return JSON.stringify(value, replacer, space);
}

function tryWrap(fn) {
    var result, error;
    try { result = fn(); }
    catch(e) { return [ err, null ]; }
    return [ null, result ];
}

util.inspect.defaultOptions.depth = null;
util.inspect.defaultOptions.maxArrayLength = null;
util.inspect.defaultOptions.maxStringLength = null;
util.inspect.defaultOptions.breakLength = Infinity;
util.inspect.defaultOptions.compact = 0;

/* Extend the standard util library.
 * May be a bad idea... */
Object.assign(module.exports, util, {
    bufArr2str,
    bufArrLen,
    checkData,
    clone,
    cmpDefault,
    cmpIntSplit,
    eq,
    err2str,
    first,
    humanNumber,
    ifNot,
    isObject,
    lsDirSync,
    makeCmpFn,
    makeCmpKey,
    makeCmpMultiFn,
    oempty,
    oget,
    ogroup,
    okeys,
    omatch,
    omerge,
    opush,
    orm,
    oset,
    owalk,
    Ranges,
    ranstr,
    safePromise,
    sha256,
    sleep,
    stringifySortedKeys,
    tryWrap,
});
