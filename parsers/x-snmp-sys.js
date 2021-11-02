'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-sys';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^(?<oid>[\d.]+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: SECTION },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
            ],
            data: [
                {
                    group: 'oid',
                    match: {
                        '.1.3.6.1.2.1.1.1.0': { key: 'sysDescr', group: 'data', apply: parser.decHexString },
                        '.1.3.6.1.2.1.1.2.0': { key: 'sysObjectID', group: 'data', apply: (x) =>
                            parser.decOidName(x, { downTo: '.1.3.6.1.4', maxTries: 3 }) },
                        '.1.3.6.1.2.1.1.4.0': { key: 'sysContact', group: 'data', apply: parser.decHexString },
                        '.1.3.6.1.2.1.1.5.0': { key: 'sysName', group: 'data', apply: parser.decHexString },
                        '.1.3.6.1.2.1.1.6.0': { key: 'sysLocation', group: 'data', apply: parser.decHexString },
                    },
                },
            ],
        },
    ],
}

parser.register(SECTION, DEFINITION);
