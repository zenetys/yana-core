'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-lldpLoc';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^\.1\.0\.8802\.1\.1\.2\.1\.3\.7\.1(?<oid>\.\d+)\.(?<last1>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: `${SECTION}Port` },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                { group: 'last1' },
            ],
            data: [
                { group: 'last1', key: 'portNum', apply: parser.decNum },
                {
                    group: 'oid',
                    match: {
                        '.2': { key: 'portIdSubtype', group: 'data', apply: parser.decNum },
                        '.3': { key: 'portId', group: 'data' }, /* decode depends on subtype */
                        '.4': { key: 'portDesc', group: 'data', apply: parser.decHexString },
                    },
                },
            ],
        },
        {
            /* restrict to ipv4 management address */
            regex: /^\.1\.0\.8802\.1\.1\.2\.1\.3\.8\.1(?<oid>\.\d+)\.1\.4\.(?<ip>[\d.]+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: `${SECTION}Man` },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
            ],
            data: [
                /* any matching oid will fill the management address */
                { group: 'ip', key: 'manAddr' },
            ],
        },
        {
            regex: /^\.1\.0\.8802\.1\.1\.2\.1\.3(?<oid>[\d.]+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: `${SECTION}Sys` },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
            ],
            data: [
                {
                    group: 'oid',
                    match: {
                        '.1.0': { key: 'chassisIdSubtype', group: 'data', apply: parser.decNum },
                        '.2.0': { key: 'chassisId', group: 'data' }, /* decode depends on subtype */
                        '.3.0': { key: 'sysName', group: 'data', apply: parser.decHexString },
                        '.4.0': { key: 'sysDesc', group: 'data', apply: parser.decHexString },
                        '.5.0': { key: 'sysCapSupported', group: 'data', apply: parser.decHexStringBits },
                        '.6.0': { key: 'sysCapEnabled', group: 'data', apply: parser.decHexStringBits },
                    },
                },
            ],
        },
    ],

    onSectionClose: (ctx) => {
        if (ctx.db[`${SECTION}Sys`] && ctx.db[`${SECTION}Sys`][ctx.section[2]]) {
            let sys = ctx.db[`${SECTION}Sys`][ctx.section[2]];

            if (sys.chassisId !== undefined && sys.chassisIdSubtype !== undefined)
                sys.chassisIdDecoded = parser.decLldpChassisId(sys.chassisId, sys.chassisIdSubtype);
            if (sys.sysCapSupported !== undefined)
                sys.sysCapSupportedNames = parser.decLldpCap(sys.sysCapSupported);
            if (sys.sysCapEnabled !== undefined)
                sys.sysCapEnabledNames = parser.decLldpCap(sys.sysCapEnabled);
        }
        if (ctx.db[`${SECTION}Port`] && ctx.db[`${SECTION}Port`][ctx.section[2]]) {
            let ports = ctx.db[`${SECTION}Port`][ctx.section[2]];

            for (let [k,v] of Object.entries(ports)) {
                if (v.portId !== undefined && v.portIdSubtype !== undefined)
                    v.portIdDecoded = parser.decLldpPortId(v.portId, v.portIdSubtype);
            }
        }
        return true;
    },
}

parser.register(SECTION, DEFINITION);
