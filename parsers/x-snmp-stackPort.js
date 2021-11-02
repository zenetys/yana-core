'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-stackPort';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^(?<oid>[\d.]+)\.(?<last2>\d+)\.(?<last1>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: SECTION },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                { fn: (ctx, cap) => cap.groups.last2 + '.' + cap.groups.last1 },
            ],
            data: [
                { group: 'last2', key: 'portModuleIndex', apply: parser.decNum },
                { group: 'last1', key: 'portIndex', apply: parser.decNum },
                {
                    group: 'oid',
                    match: {
                        '.1.3.6.1.4.1.9.5.1.4.1.1.11': { group: 'data', key: 'ifIndex', apply: parser.decNum },
                        '.1.3.6.1.4.1.9.5.1.9.3.1.8': { group: 'data', key: 'vlanPortIslOperStatus', apply: parser.decNum },
                    },
                },
            ],
        },
    ],
}

parser.register(SECTION, DEFINITION);
