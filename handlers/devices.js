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
                fdb: {
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

const FDB_KEYS = {
    swId: true,
    swName: true,
    swIface: true,
    fdbVlan: true,
    fdbMac: true,
    fdbMacVendor: true,
    fdbMacDid: true,
    fdbMacDname: true,
    fdbMacIp: true,
    swIfTotalMac: true,
    swIfUplink: true,
};

/* Devices listing, SwPort column for non-switch devices
 * List ports were the given macs are seen, skipping switches uplinks, sorted
 * by fdb mac counts. The first entry is the most probable port were the device
 * is connected.
 */
function getSwPort(db, macs) {
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

/* Devices listing, SwPort column for switches
 * List neighbors uplinks, sorted by fdb mac count descending. The first entry
 * is assumed to be the most relevant uplink.
 */
function getUplinks(db, did, ifname) {
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

class HandlerDevices extends handler.Handler {

    constructor() {
        super(OPTIONS);
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

        /* specific device id requested, ignore short */
        if (ctx.url.qs.id) {
            if (db.sdevice && db.sdevice[ctx.url.qs.id])
                return this.headEnd(ctx, 200, JSON.stringify(db.sdevice[ctx.url.qs.id]));
            return this.headEnd(ctx, 404);
        }

        /* listing */
        var out = Object.values(db.sdevice);
        out = out.map((o) => util.clone(o)); /* read-only db */

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
            d.swPort = ocap.switch ? getUplinks(db, d.id) : getSwPort(db, d.mac);
        }

        var sortMode = 'device';

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

        /* short mode (listing devices) */
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
        /* fdb mode (listng fdb) */
        else if (ctx.url.qs.fdb !== undefined) {
            sortMode = 'fdb';
            let dlist = out;
            out = [];

            /* get all macs in dlist */
            let dlistMac = {};
            for (let d of dlist) {
                let dmac = dbhelpers.getDeviceMacs(db, d.id, { object: true });
                util.omerge(dlistMac, dmac);
            }
            /* search each mac in srfdb, this gives switchports where the
             * mac is seen. */
            for (let m in dlistMac) {
                if (!db.srfdb[m])
                    continue;
                for (let fdbEntry of db.srfdb[m]) {
                    /* must assume these may be undefined */
                    let fdbMacDid, fdbMacDname, fdbMacDip, swIfTotalMac;

                    fdbMacDid = util.oget(db, ['ualias', 'device', 'mac', m]);
                    if (fdbMacDid) {
                        fdbMacDname = dbhelpers.getDeviceName(db, fdbMacDid);
                        fdbMacDip = dbhelpers.getDeviceIp(db, fdbMacDid, false);
                        let swIfFdb = util.oget(db, ['sfdb', fdbEntry.did, fdbEntry.ifname]);
                        if (swIfFdb) {
                            let byMac = {};
                            for (let i of swIfFdb)
                                byMac[i.mac] = i.mac;
                            swIfTotalMac = Object.keys(byMac).length;
                        }
                    }

                    out.push({
                        swId: fdbEntry.did,
                        swName: dbhelpers.getDeviceBestName(db, fdbEntry.did),
                        swIface: fdbEntry.ifname,
                        fdbVlan: fdbEntry.vlan,
                        fdbMac: m,
                        fdbMacVendor: util.first(dbhelpers.getMacsVendors(m)),
                        fdbMacDid: fdbMacDid || null,
                        fdbMacDname: fdbMacDname || null,
                        fdbMacDip: fdbMacDip || null,
                        swIfTotalMac: swIfTotalMac || null,
                        swIfUplink: getUplinks(db, fdbEntry.did, fdbEntry.ifname),
                    });
                }
            }
        }

        if (sortMode == 'device') {
            out.sort(util.makeCmpMultiFn([
                { fn: util.makeCmpFn((e) => e.ip ? 100 : 900) },
                { fn: util.makeCmpFn((e) => e.mac ? 100 : 900) },
                { fn: util.makeCmpFn((e) => e.name ? 100 : 900) },
                { fn: util.makeCmpFn((e) => e.ip && e.ip[0] ? e.ip[0] : '', 1, util.cmpIntSplit) },
                { fn: util.makeCmpFn((e) => e.mac && e.mac[0] ? e.mac[0] : undefined, 1, util.cmpDefault) },
                { fn: util.makeCmpFn((e) => e.name && e.name[0] ? e.name[0] : undefined, 1, util.cmpDefault) },
            ]));
        }
        else if (sortMode == 'fdb') {
            out.sort(util.makeCmpMultiFn([
                { fn: util.makeCmpKey('swIfTotalMac', 1) },
                { fn: util.makeCmpFn((e) => e.swName, 1, util.cmpDefault) },
                { fn: util.makeCmpFn((e) => e.swIface, 1, util.cmpDefault) },
                { fn: util.makeCmpFn((e) => e.fdbVlan, 1, util.cmpDefault) },
                { fn: util.makeCmpFn((e) => e.fdbMacDname, 1, util.cmpDefault) },
            ]));
        }

        this.headEnd(ctx, 200, JSON.stringify(out));
    }
}

handler.register('GET', '/entity/*/devices', new HandlerDevices());
