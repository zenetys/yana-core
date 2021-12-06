'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-lldpRem';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^\.1\.0\.8802\.1\.1\.2\.1\.4\.1\.1(?<oid>\.\d+)\.\d+\.(?<last2>\d+)\.(?<last1>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: SECTION },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                {
                    autoinc: {
                        base: [
                            { value: SECTION },
                            { fn: (ctx, cap) => ctx.section[2] },
                        ],
                        uniq: [
                            { group: 'last2' },
                            { group: 'last1' },
                        ],
                    },
                },
            ],
            data: [
                { group: 'last2', key: 'localPortNum', apply: parser.decNum },
                {
                    group: 'oid',
                    match: {
                        '.4': { key: 'chassisIdSubtype', group: 'data', apply: parser.decNum },
                        '.5': { key: 'chassisId', group: 'data' }, /* decode depends on subtype */
                        '.6': { key: 'portIdSubtype', group: 'data', apply: parser.decNum },
                        '.7': { key: 'portId', group: 'data' },  /* decode depends on subtype */
                        '.8': { key: 'portDesc', group: 'data', filter: (v) => v != '6E 6F 74 20 61 64 76 65 72 74 69 73 65 64 ', apply: parser.decHexString },
                        '.9': { key: 'sysName', group: 'data', filter: (v) => v != '6E 6F 74 20 61 64 76 65 72 74 69 73 65 64 ', apply: parser.decHexString },
                        '.10': { key: 'sysDesc', group: 'data', filter: (v) => v != '6E 6F 74 20 61 64 76 65 72 74 69 73 65 64 ', apply: parser.decHexString },
                        '.11': { key: 'sysCapSupported', group: 'data', apply: parser.decHexStringBits },
                        '.12': { key: 'sysCapEnabled', group: 'data', apply: parser.decHexStringBits },
                    },
                },
            ],
        },
        {
            /* restrict to ipv4 management address */
            regex: /^\.1\.0\.8802\.1\.1\.2\.1\.4\.2\.1(?<oid>\.\d+)\.\d+\.(?<last2>\d+)\.(?<last1>\d+)\.1\.4\.(?<manAddr>[\d.]+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: SECTION },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                {
                    autoinc: {
                        base: [
                            { value: SECTION },
                            { fn: (ctx, cap) => ctx.section[2] },
                        ],
                        uniq: [
                            { group: 'last2' },
                            { group: 'last1' },
                        ],
                    },
                },
            ],
            data: [
                { group: 'last2', key: 'localPortNum', apply: parser.decNum },
                { group: 'manAddr', key: 'manAddr' },
            ],
        },
        {
            regex: /^\.1\.0\.8802\.1\.1\.2\.1\.4\.4\.1/,
            filter: () => false,
        }
    ],

    onSectionClose: (ctx) => {
        if (ctx.db[SECTION] && ctx.db[SECTION][ctx.section[2]]) {
            for (let o in ctx.db[SECTION][ctx.section[2]]) {
                o = ctx.db[SECTION][ctx.section[2]][o];

                if (o.chassisId !== undefined && o.chassisIdSubtype !== undefined)
                    o.chassisIdDecoded = parser.decLldpChassisId(o.chassisId, o.chassisIdSubtype);
                if (o.portId !== undefined && o.portIdSubtype !== undefined)
                    o.portIdDecoded = parser.decLldpPortId(o.portId, o.portIdSubtype);

                if (o.sysCapSupported !== undefined)
                    o.sysCapSupportedNames = parser.decLldpCap(o.sysCapSupported);
                if (o.sysCapEnabled !== undefined)
                    o.sysCapEnabledNames = parser.decLldpCap(o.sysCapEnabled);
            }
        }
        return true;
    },
}

parser.register(SECTION, DEFINITION);
