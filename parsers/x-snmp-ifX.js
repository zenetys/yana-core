'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-ifX';

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
                        '.1.3.6.1.2.1.31.1.1.1.1': { key: 'ifName', group: 'data', apply: parser.decHexString },
                        '.1.3.6.1.2.1.31.1.1.1.15': { key: 'ifSpeed', group: 'data', filter: (v) => v != '0', apply: (x) => parser.decNum(x) * 1e6 },
                        '.1.3.6.1.2.1.31.1.1.1.18': { key: 'ifAlias', group: 'data', apply: parser.decHexString },
                    },
                },
            ],
        },
    ],
}

parser.register(SECTION, DEFINITION);
