'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-inetCidrRoute';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^(?<oid>.+)\.(?<destType>1|2)\.(4|16)\.(?<dest>\d+((\.\d+){15}|(\.\d+){3}))\.(?<pfxLen>\d+)(\.\d+)+\.(1|2)\.(4|16)\.(?<nextHop>\d+((\.\d+){15}|(\.\d+){3})) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            fn: (ctx, cap) => {
                if (cap.groups.destType != 1) /* != ipv4, for now */
                    return null; /* ignore */
                return true;
            },
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
                            { group: 'destType' },
                            { group: 'dest' },
                            { group: 'pfxLen' },
                            { group: 'nextHop' }
                        ],
                    },
                },
            ],
            data: [
                { group: 'destType', key: 'destType', apply: parser.decNum },
                { group: 'dest', key: 'dest' },
                { group: 'pfxLen', key: 'pfxLen', apply: parser.decNum },
                { group: 'nextHop', key: 'nextHop' },
                {
                    group: 'oid',
                    match: {
                        '.1.3.6.1.2.1.4.24.7.1.7': { key: 'ifIndex', group: 'data', apply: parser.decNum },
                        '.1.3.6.1.2.1.4.24.7.1.12': { key: 'metric1', group: 'data', apply: parser.decNum },
                    },
                },
            ],
        },
    ],
}

parser.register(SECTION, DEFINITION);
