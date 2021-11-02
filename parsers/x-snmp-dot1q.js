'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-dot1q';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^\.1\.3\.6\.1\.2\.1\.17\.7\.1\.4\.2\.1(?<oid>\.\d+)\.\d+\.(?<last1>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: `${SECTION}Vlan` },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                { group: 'last1' },
            ],
            data: [
                { group: 'last1', key: 'dot1qVlanIndex', apply: parser.decNum },
                {
                    group: 'oid',
                    match: {
                        '.3': { group: 'data', key: 'dot1qVlanFdbId', apply: parser.decNum },
                        '.4': { group: 'data', key: 'dot1qVlanCurrentEgressPorts', apply: parser.decQBridgePorts },
                        '.5': { group: 'data', key: 'dot1qVlanCurrentUntaggedPorts', apply: parser.decQBridgePorts },
                    },
                },
            ],
        },
        {
            regex: /^\.1\.3\.6\.1\.2\.1\.17\.7\.1\.4\.3\.1\.1\.(?<last1>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: `${SECTION}Vlan` },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                { group: 'last1' },
            ],
            data: [
                { group: 'last1', key: 'dot1qVlanIndex', apply: parser.decNum },
                { group: 'data', key: 'dot1qVlanStaticName', apply: parser.decHexString },
            ],
        },
        {
            regex: /^\.1\.3\.6\.1\.2\.1\.17\.7\.1\.2\.2\.1\.2\.(?<dot1qFdbId>\d+)\.(?<mac>\d+(\.\d+){5}) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined && cap.groups.data != '0',
            index: [
                { value: `${SECTION}TpFdb` },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                {
                    autoinc: {
                        base: [
                            { value: `${SECTION}Fdb` },
                            { fn: (ctx, cap) => ctx.section[2] },
                        ],
                        uniq: [
                            { group: 'dot1qFdbId' },
                            { group: 'mac' },
                        ],
                    },
                },
            ],
            data: [
                { group: 'dot1qFdbId', key: 'dot1qFdbId', apply: parser.decNum },
                { group: 'mac', key: 'mac', apply: parser.decOidMac },
                { group: 'data', key: 'dot1dBasePort', apply: parser.decNum },
            ],
        },
        {
            regex: /^\.1\.3\.6\.1\.2\.1\.17\.7\.1\.4\.5\.1\.1\.(?<last1>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined && cap.groups.data != '0',
            index: [
                { value: 'x-snmp-dot1dBasePort' },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                { group: 'last1' },
            ],
            data: [
                { group: 'last1', key: 'dot1dBasePort', apply: parser.decNum },
                { group: 'data', key: 'dot1qPvid', apply: parser.decNum },
            ],
        },
    ],
}

parser.register(SECTION, DEFINITION);
