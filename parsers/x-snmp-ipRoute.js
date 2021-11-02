'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-ipRoute';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^(?<oid>[\d.]+)\.(?<ip>\d+(\.\d+){3}) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
//            fn: (ctx, cap) => {
//                if (cap.groups.ip.substr(0, 4) == '127.' ||
//                    cap.groups.ip.substr(0, 4) == '224.' ||
//                    cap.groups.ip.substr(-4) == '.255')
//                    return null; /* ignore */
//                return true;
//            },
            index: [
                { value: SECTION },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                { group: 'ip' },
            ],
            data: [
                { group: 'ip', key: 'dest' },
                {
                    group: 'oid',
                    match: {
                        '.1.3.6.1.2.1.4.21.1.2': { key: 'ifIndex', group: 'data', apply: parser.decNum },
                        '.1.3.6.1.2.1.4.21.1.3': { key: 'metric1', group: 'data', apply: parser.decNum },
                        '.1.3.6.1.2.1.4.21.1.7': { key: 'nextHop', group: 'data' },
                        '.1.3.6.1.2.1.4.21.1.11': { key: 'mask', group: 'data' },
                    },
                },
            ],
        },
    ],
}

parser.register(SECTION, DEFINITION);
