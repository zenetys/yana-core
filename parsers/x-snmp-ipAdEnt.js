'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-ipAdEnt';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^(?<oid>[\d.]+)\.(?<ip>\d+(\.\d+){3}) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
//            fn: (ctx, cap) => {
//                if (cap.groups.ip.substr(0, 4) == '127.')
//                    return null; /* ignore */
//                return true;
//            }
            index: [
                { value: SECTION },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                { group: 'ip' },
            ],
            data: [
                { group: 'ip', key: 'ip' },
                {
                    group: 'oid',
                    match: {
                        '.1.3.6.1.2.1.4.20.1.2': { key: 'ifIndex', group: 'data', apply: parser.decNum },
                        '.1.3.6.1.2.1.4.20.1.3': { key: 'mask', group: 'data' },
                    }
                }
            ],
        },
    ],
}

parser.register(SECTION, DEFINITION);

// FIXME: filter irrelevant addresses
