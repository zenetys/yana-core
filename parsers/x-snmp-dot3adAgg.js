'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-dot3adAgg';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^\.1\.2\.840\.10006\.300\.43\.1\.2\.1\.1\.12\.(?<last1>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined &&
                                  cap.groups.data != '0' &&
                                  cap.groups.data != cap.groups.last1,
            index: [
                { value: 'x-snmp-if' },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                { group: 'last1' },
            ],
            data: [
                { group: 'last1', key: 'ifIndex', apply: parser.decNum },
                { group: 'data', key: 'dot3adAggIfIndex', apply: parser.decNum },
            ],
        },
    ],
}

parser.register(SECTION, DEFINITION);
