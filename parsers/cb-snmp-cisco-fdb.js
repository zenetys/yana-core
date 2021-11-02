'use strict';

const parser = require('../parser.js');

const SECTION = 'cb-snmp-cisco-fdb';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 4,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^\.1\.3\.6\.1\.2\.1\.17\.4\.3\.1\.2\.(?<mac>\d+(\.\d+){5}) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined && cap.groups.data != '0',
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
                            { fn: (ctx, cap) => ctx.section[3] },
                            { group: 'mac' },
                        ],
                    },
                },
            ],
            data: [
                { fn: (ctx, cap) => ctx.section[3], key: 'vlan', apply: parser.decNum },
                { group: 'mac', key: 'mac', apply: parser.decOidMac },
                { group: 'data', key: 'dot1dBasePort', apply: parser.decNum },
            ],
        },
        {
            regex: /^\.1\.3\.6\.1\.2\.1\.17\.1\.4\.1\.2\.(?<last1>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: 'x-snmp-dot1dBasePort' },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                { group: 'last1' },
            ],
            data: [
                { group: 'last1', key: 'dot1dBasePort', apply: parser.decNum },
                { group: 'data', key: 'ifIndex', apply: parser.decNum },
            ],
        },
    ],
}

parser.register(SECTION, DEFINITION);
