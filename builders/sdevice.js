'use strict';

/* Be careful here when changing array vs single value in properties because
 * there are dbhelpers that rely on the sdevice table. */

const builder = require('../builder.js');
const util = require('../util.js');

const DEFINITION = {
    comment: 'build short device table',
    fn: run,
    spec: {
        '*': {
            '*': {
                '@': {
                    sort: util.makeCmpMultiFn([
                        { fn: builder.makeCmpOriginPrio([ 'snmp' ]) },
                        { fn: util.makeCmpFn((d) => builder.dataValue(d)) },
                    ]),
                    uniq: true,
                },
            },
            capability: {
                '@': {
                    sort: util.makeCmpMultiFn([
                        { fn: builder.makeCmpOriginPrio([ 'lldp', 'cdp' ]) },
                        { fn: util.makeCmpFn((d) => builder.dataValue(d)) },
                    ]),
                },
            },
            iface: {
                '*': {
                    '*': {
                        '@': {
                            sort: util.makeCmpMultiFn([
                                { fn: builder.makeCmpOriginPrio([ 'snmp' ]) },
                            ]),
                            fn: (dlva) => dlva[0] /* first */
                        },
                    },
                    ip: {
                        '@': {
                            fn: undefined, /* cancel '*' first */
                        },
                    },
                    member: {
                        '@': {
                            sort: util.makeCmpMultiFn([
                                { fn: builder.makeCmpOriginPrio([ 'x-snmp-hwTrunk',
                                    'snmp' ]) },
                            ]),
                        },
                    },
                    memberOf: {
                        '@': {
                            sort: util.makeCmpMultiFn([
                                { fn: builder.makeCmpOriginPrio([ 'x-snmp-hwTrunk',
                                    'snmp' ]) },
                            ]),
                        },
                    },
                    name: {
                        '@': {
                            sort: undefined, /* cancel '*' sort */
                            fn: undefined, /* cancel '*' first */
                        },
                    },
                    pvlan: {
                        '@': {
                            sort: util.makeCmpMultiFn([
                                { fn: builder.makeCmpOriginPrio([ 'x-snmp-vm',
                                    'x-snmp-vlanTrunkPort', 'x-snmp-cisco-smb-vlan',
                                    'x-snmp-dot1q', 'snmp' ]) },
                            ]),
                        },
                    },
                    swPortMode: {
                        '@': {
                            sort: util.makeCmpMultiFn([
                                { fn: builder.makeCmpOriginPrio([ 'x-snmp-vlanTrunkPort',
                                    'x-snmp-cisco-smb-vlan', 'x-snmp-dot1q', 'snmp' ]) },
                            ]),
                        },
                    },
                    tagged: {
                        '@': {
                            sort: util.makeCmpMultiFn([
                                { fn: builder.makeCmpOriginPrio([ 'x-snmp-vm',
                                    'x-snmp-vlanTrunkPort', 'x-snmp-cisco-smb-vlan',
                                    'x-snmp-dot1q', 'snmp' ]) },
                            ]),
                        },
                    },
                    trunkStatus: {
                        '@': {
                            sort: util.makeCmpMultiFn([
                                { fn: builder.makeCmpOriginPrio([ 'x-snmp-vlanTrunkPort',
                                    'x-snmp-stackPort', 'x-snmp-cisco-smb-vlan',
                                    'x-snmp-dot1q', 'snmp' ]) },
                            ]),
                        },
                    },
                    untagged: {
                        '@': {
                            sort: util.makeCmpMultiFn([
                                { fn: builder.makeCmpOriginPrio([ 'x-snmp-vm',
                                    'x-snmp-vlanTrunkPort', 'x-snmp-cisco-smb-vlan',
                                    'x-snmp-dot1q', 'snmp' ]) },
                            ]),
                        },
                    },
                },
            },
            ip: {
                '@': {
                    filter: (d) => builder.dataValue(d).substr(0, 4) != '127.',
                    sort: util.makeCmpMultiFn([
                        { fn: builder.makeCmpOriginPrio([ 'cdp', 'lldp', 'arpcount', 'fping' ]) },
                        { fn: builder.makeCmpDataIp() },
                    ]),
                },
            },
            name: {
                '@': {
                    sort: util.makeCmpMultiFn([
                        { fn: builder.makeCmpOriginPrio([ 'sys' ]) },
                    ]),
                }
            },
            route: {
                '@': {
                    /* keep only x-snmp-inetCidrRoute if available because
                     * entries in x-snmp-ipRoute may not have the same
                     * metric value */
                    uniq: undefined, /* cancel '*' uniq */
                    format: false, /* noop, format is done in fn */
                    fn: (dle) => {
                        if (dle.some((d) => builder.dataOrigin(d) == 'x-snmp-inetCidrRoute'))
                            dle = dle.filter((d) => builder.dataOrigin(d) == 'x-snmp-inetCidrRoute')
                        return dle.map((d) => builder.dataValue(d));
                    },
                },
            },
            vlan: {
                '*': {
                    '*': {
                        '@': {
                            fn: (dlva) => dlva[0] /* first */
                        },
                    },
                },
            },
        },
    },
};

function run(ctx, def) {
    ctx.db.sdevice = builder.simplify(ctx.db.device, def.spec);
    return true;
}

builder.register(600, DEFINITION);
