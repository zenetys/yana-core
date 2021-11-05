'use strict';

const builder = require('../builder.js');
const util = require('../util.js');

function formatNei(da) {
    let byProto = util.ogroup(da,
        (k, d) => (builder.dataOrigin(d).toLowerCase().indexOf('lldp') > -1)
                    ? 'lldp' : 'other');

    if (byProto.lldp && byProto.other)
        da = byProto.lldp;

    let byOrigin = util.ogroup(da, (k, d) => builder.dataOrigin(d));
    for (let o in byOrigin) {
        byOrigin[o] = byOrigin[o].map((d) => builder.dataValue(d));
        byOrigin[o] = builder.data(byOrigin[o], o);
    }

    byOrigin = Object.values(byOrigin)
        .sort(
            util.makeCmpMultiFn([
                { fn: builder.makeCmpOriginPrio([ 'snmp' ]) },
            ])
        )
        .map((d) => builder.dataValue(d))[0];

    return byOrigin;
}

function addNeiInverse(onei) {
    for (let did in onei) {
        for (let ifname in onei[did]) {
            for (let n of onei[did][ifname]) {
                let orev = util.oget(onei, [ n.id, n.ifname ]);
                if (!orev || orev.findIndex((e) => e.id == did && e.ifname == ifname) == -1)
                    util.opush(onei, [ n.id, n.ifname ], { id: did, ifname: ifname, inversed: true });
            }
        }
    }
}

const DEFINITION = {
    comment: 'build short nei table',
    fn: run,
    spec: {
        '*': {
            '*': {
                '@': {
                    format: false,
                    fn: formatNei,
                },
            },
        },
    },
};

function run(ctx, def) {
    ctx.db.snei = builder.simplify(ctx.db.nei, def.spec);
    addNeiInverse(ctx.db.snei);
    return true;
}

builder.register(640, DEFINITION);
