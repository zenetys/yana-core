'use strict';

const builder = require('../builder.js');
const util = require('../util.js');

const DEFINITION = {
    comment: 'handle data known to be invalid, for instance due to bugs on devices',
    fn: run,
};

function run(ctx, def) {
    util.oget(ctx.ndb, ['x-snmp-sys'], (o) => {
        for (let k1 in o) {
            let v = o[k1];

            /* Samsung C1860 Series; V4.00.04.06 OCT-14-2016;Engine V1.00.31;NIC V4.01.62 10-13-2016;S/N XXXXXXXXXXXXXXX */
            if (v.sysDescr !== undefined && v.sysDescr.indexOf('Samsung C1860 ') == 0) {
                /* oids for ips are malformed */
                ctx.log.debug2(`Delete ndb entry x-snmp-arp.${k1}`);
                util.orm(ctx.ndb, ['x-snmp-arp', k1]);

                /* some oids mention an ifIndex that do not exist */
                let ifTable = util.oget(ctx.ndb, ['x-snmp-if', k1]);
                if (ifTable !== undefined) {
                    let realIfIndex = Object.keys(ifTable);
                    util.owalk(ctx.ndb, (o, path) => {
                        if (path[1] == k1 && o.ifIndex !== undefined && !realIfIndex.some((i)=> (i == o.ifIndex))) {
                            ctx.log.debug2(`Delete ndb entry ${path.join('.')}`);
                            util.orm(ctx.ndb, path);
                            return path.length - 1;
                        }
                        return true;
                    });
                }
            }
        }
    });

    util.oget(ctx.ndb, ['x-snmp-ipAdEnt'], (o) => {
        /* iLO SNMP passthru produces inconsistencies because the iLO IP address returns
         * IF-MIB data of the server, leading the iLO IP and mac to be attached to the
         * device entry of the server. Drop any snmp data from the nscan db if the nscan
         * IP is not in the ipAdEnt table. */
        for (let nscanIp in o) {
            if (o[nscanIp][nscanIp] === undefined) {
                /* delete snmp data for this nscan ip */
                for (let table in ctx.ndb) {
                    if (table.indexOf('snmp') > -1) {
                        ctx.log.debug2(`Delete ndb entry ${table}.${nscanIp}`);
                        util.orm(ctx.ndb, [table, nscanIp]);
                    }
                }
            }
        }
    });

    return true;
}

builder.register(100, DEFINITION);
