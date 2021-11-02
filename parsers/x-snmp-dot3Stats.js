'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-dot3Stats';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^(?<oid>[\d.]+)\.(?<last1>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: 'x-snmp-if' },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                { group: 'last1' },
            ],
            data: [
                { group: 'last1', key: 'ifIndex', apply: parser.decNum },
                {
                    group: 'oid',
                    match: {
                        '.1.3.6.1.2.1.10.7.2.1.19': { key: 'duplexStatus', group: 'data', apply: parser.decNum },
                    },
                },
            ],
        },
    ],
}

parser.register(SECTION, DEFINITION);
