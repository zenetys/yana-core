'use strict';

const builder = require('../builder.js');
const config = require('../config.js');
const cache = require('../cache.js');
const dbhelpers = require('../dbhelpers.js');
const handler = require('../handler.js');
const handlerDevices = require('../handlers/devices.js');
const Logger = require('../logger.js');
const util = require('../util.js');

const OPTIONS = {
    log: new Logger('handler:fdb'),
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
                q: {
                    type: 'string',
                },
            },
        },
    },
};

class HandlerFdb extends handlerDevices.HandlerDevices {

    constructor() {
        super(OPTIONS);
    }

    afterSearch(ctx, db, out) {
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
                    swIfUplink: this.getUplinks(db, fdbEntry.did, fdbEntry.ifname),
                });
            }
        }

        out.sort(util.makeCmpMultiFn([
            { fn: util.makeCmpKey('swIfTotalMac', 1) },
            { fn: util.makeCmpFn((e) => e.swName, 1, util.cmpDefault) },
            { fn: util.makeCmpFn((e) => e.swIface, 1, util.cmpDefault) },
            { fn: util.makeCmpFn((e) => e.fdbVlan, 1, util.cmpDefault) },
            { fn: util.makeCmpFn((e) => e.fdbMacDname, 1, util.cmpDefault) },
        ]));

        return out;
    }
}

handler.register('GET', '/entity/*/fdb', new HandlerFdb());
