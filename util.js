"use strict";

const util = require('util');

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
        if (typeof x != 'number' && isNaN(x))
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
        if (!util.isObject(x))
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

function clone(x) {
    if (isObject(x)) {
        if (x.constructor.name == 'Object') {
            let out = x.constructor();
            for (let k in x)
                out[k] = clone(x[k]);
            /* symbols are not enumerated in for ... in loops */
            for (let k of Object.getOwnPropertySymbols(x))
                out[k] = clone(x[k]);
            return out;
        }
        if (x.constructor.name == 'Array') {
            let out = x.constructor(x.length);
            x.forEach((e, i) => { out[i] = clone(e); });
            return out;
        }
        throw Error(`clone of object type ${x.constructor.name} unsupported`);
    }
    return x;
}

function isObject(value) {
    return value !== null && typeof value == 'object' &&
        value.constructor === Object;
}

function omerge(...o) {
    function _(o1 = {}, o2 = {}) {
        Object.keys(o2).forEach((k) => {
            if (isObject(o1[k]) && isObject(o2[k]))
                _(o1[k], o2[k]);
            else
                o1[k] = clone(o2[k]);
        });
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

function safePromise(promise) {
    return promise
        .then(result => [ null, result ])
        .catch(err => [ err, null ]);
}

function sleep(ms) {
    return new Promise(function (resolve) {
        return setTimeout(resolve, ms)
    })
}

util.inspect.defaultOptions.depth = null;
util.inspect.defaultOptions.maxArrayLength = null;

/* Extend the standard util library.
 * May be a bad idea... */
Object.assign(module.exports, util, {
    checkData,
    clone,
    isObject,
    omerge,
    safePromise,
    sleep,
});
