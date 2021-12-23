'use strict';

const builder = require('../builder.js');
const config = require('../config.js');
const cache = require('../cache.js');
const dbhelpers = require('../dbhelpers.js');
const handler = require('../handler.js');
const Logger = require('../logger.js');
const util = require('../util.js');

const OPTIONS = {
    log: new Logger('handler:devices'),
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
        qs: {
            type: 'object',
            fields: {
                database: {
                    type: 'string',
                    check: (x) => x.length > 0 && x.indexOf('.') != 0,
                },
                id: {
                    type: 'string',
                    check: (x) => x.length > 0,
                },
                short: {
                    type: 'string',
                },
                q: {
                    type: 'string',
                },
            },
        },
    },
};

const SHORT_KEYS = {
    id: true,
    ip: true,
    name: true,
    description: true,
    mac: true,
    macVendor: true,
    type: true,
    swPort: true,
};

class HandlerDevices extends handler.Handler {

    constructor(options) {
        super(options || OPTIONS);
    }

    async process(ctx) {
        /* use latest database if none requested */
        if (!ctx.url.qs.database) {
            ctx.url.qs.database = cache.getLatestDbId(ctx.url.params[0]);
            if (ctx.url.qs.database instanceof Error)
                return this.headEnd(ctx, ctx.url.qs.database.code == 'ENOENT' ? 400 : 500);
            if (!ctx.url.qs.database)
                return this.headEnd(ctx, 404);
        }

        var db = await cache.getDb(ctx.url.params[0], ctx.url.qs.database);
        if (!db)
            return this.headEnd(ctx, db === null ? 400 : 500);

        if (!util.isObject(db.sdevice)) {
            this.log.error('Invalid table sdevice in database %s/%s ',
                ctx.url.params[0], ctx.url.qs.database);
            return this.headEnd(ctx, 500);
        }

        var out;

        /* specific device id requested */
        if (ctx.url.qs.id) {
            if (!db.sdevice || !db.sdevice[ctx.url.qs.id])
                return this.headEnd(ctx, 404);

            out = [ db.sdevice[ctx.url.qs.id] ];
        }
        /* listing */
        else {
            out = Object.values(db.sdevice);
            out = out.map((o) => util.clone(o)); /* read-only db */
        }

        /* computed data */
        for (let d of out) {
            let ocap = dbhelpers.normCapability(d.capability);
            let type = dbhelpers.normCapabilityType(ocap);
            if (type) {
                if (d.type)
                    d.type.unshift(type);
                else
                    d.type = [type];
            }
            d.macVendor = d.mac ? dbhelpers.getMacsVendors(d.mac) : null;
            d.swPort = ocap.switch ? this.getUplinks(db, d.id) : this.getSwPort(db, d.mac);
        }

        /* search filter */
        if (ctx.url.qs.q !== undefined) {
            ctx.url.qs.q = ctx.url.qs.q.trim();

            if (ctx.url.qs.q.length > 0) {
                let result = out.filter((o) => {
                    return util.omatch(o, ctx.url.qs.q);
                });
                out = result
            }
        }

        /* overridable "after search filtering" hook */
        out = this.afterSearch(ctx, db, out);

        if (ctx.url.qs.id)
            out = out[0]; /* assume single element array */

        this.headEnd(ctx, 200, JSON.stringify(out));
    }


    /* SwPort column for non-switch devices
     * List ports were the given macs are seen, skipping switches uplinks, sorted
     * by fdb mac counts. The first entry is the most probable port were the device
     * is connected.
     */
    getSwPort(db, macs) {
        var seenOn = [];
        if (!macs)
            return seenOn;

        for (let m of macs) {
            let mports = util.oget(db.srfdb, [m]);
            /* group by did/ifname to ignore vlan and enforce uniqueness */
            mports = util.ogroup(mports, (k, v) => v.did, (k, v) => v.ifname);
            for (let mpdid in mports) {
                for (let mpifname in mports[mpdid]) {
                    /* skip switch uplinks */
                    let swnei = dbhelpers.getNei(db, mpdid, mpifname, ['switch']);
                    if (swnei.length > 0)
                        continue;
                    let portmacs = util.oget(db.sfdb, [mpdid, mpifname]) || [];
                    seenOn.push({
                        id: mpdid,
                        ifname: mpifname,
                        count: dbhelpers.countSfdbMacs(portmacs),
                    });
                }
            }
        }

        seenOn.sort(util.makeCmpFn((o) => o.count));
        seenOn = seenOn.map((o) => ({
            id: o.id,
            name: dbhelpers.getDeviceBestName(db, o.id, true),
            iface: dbhelpers.shortIfname(o.ifname),
            count: o.count,
        }));
        return seenOn;
    }

    /* SwPort column for switches
     * List neighbors uplinks, sorted by fdb mac count descending. The first entry
     * is assumed to be the most relevant uplink.
     */
    getUplinks(db, did, ifname) {
        var out = dbhelpers.getNei(db, did, ifname, ['switch']);
        out = out.map((n) => {
            let fdb = util.oget(db.sfdb, [n.id, n.ifname]) || [];
            let nn = {
                id: n.id,
                name: dbhelpers.getDeviceBestName(db, n.id, true),
                iface: dbhelpers.shortIfname(n.ifname),
                count: dbhelpers.countSfdbMacs(fdb),
            }
            return nn;
        });
        out.sort(util.makeCmpFn((o) => o.count, -1));
        return out;
    }

    afterSearch(ctx, db, out) {
        /* skip on specific device id request */
        if (ctx.url.qs.id)
            return out;

        /* short mode */
        if (ctx.url.qs.short !== undefined) {
            out = out.map((o) => {
                let oo = {};
                for (let k in SHORT_KEYS) {
                    oo[k] = typeof SHORT_KEYS[k] == 'function'
                        ? SHORT_KEYS[k](o[k]) : o[k];
                    if (!oo[k])
                        oo[k] = null;
                }
                return oo;
            });
        }

        out.sort(util.makeCmpMultiFn([
            { fn: util.makeCmpFn((e) => e.ip ? 100 : 900) },
            { fn: util.makeCmpFn((e) => e.mac ? 100 : 900) },
            { fn: util.makeCmpFn((e) => e.name ? 100 : 900) },
            { fn: util.makeCmpFn((e) => e.ip && e.ip[0] ? e.ip[0] : '', 1, util.cmpIntSplit) },
            { fn: util.makeCmpFn((e) => e.mac && e.mac[0] ? e.mac[0] : undefined, 1, util.cmpDefault) },
            { fn: util.makeCmpFn((e) => e.name && e.name[0] ? e.name[0] : undefined, 1, util.cmpDefault) },
        ]));

        return out;
    }
}

handler.register('GET', '/entity/*/devices', new HandlerDevices());

module.exports = {
    HandlerDevices,
};
