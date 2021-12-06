'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-cefex';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^\.1\.3\.6\.1\.4\.1\.9\.9\.691\.1\.1\.1\.1\.2\.(?<ifIndex>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: `${SECTION}Binding` },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                { group: 'ifIndex' },
            ],
            data: [
                { group: 'ifIndex', key: 'ifIndex', apply: parser.decNum },
                { group: 'data', key: 'fexIndex', apply: parser.decNum },
            ],
        },
        {
            regex: /^\.1\.3\.6\.1\.4\.1\.9\.9\.691\.1\.1\.2\.1\.1\.(?<fexIndex>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: `${SECTION}Name` },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                { group: 'fexIndex' },
            ],
            data: [
                { group: 'fexIndex', key: 'fexIndex', apply: parser.decNum },
                { group: 'data', key: 'fexName', apply: parser.decHexString },
            ],
        },
    ],
}

parser.register(SECTION, DEFINITION);
