'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-hwTrunk';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^\.1\.3\.6\.1\.4\.1\.2011\.5\.25\.41\.1\.3\.3\.1\.4\.(?<last1>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: `${SECTION}` },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                { group: 'last1' },
            ],
            data: [
                { group: 'last1', key: 'hwTrunkIndex', apply: parser.decNum },
                { group: 'data', key: 'hwTrunkIfIndex', apply: parser.decNum },
            ],
        },
        {
            regex: /^\.1\.3\.6\.1\.4\.1\.2011\.5\.25\.41\.1\.4\.1\.1\.2\.(?<last2>\d+)\.(?<last1>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: `${SECTION}` },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                { group: 'last2' },
                { value: 'hwTrunkMem' },
                {
                    autoinc: {
                        base: [
                            { value: SECTION },
                            { fn: (ctx, cap) => ctx.section[2] },
                            { group: 'last2' },
                        ],
                        uniq: [
                            { group: 'last1' },
                        ],
                    },
                },
            ],
            data: [
                { group: 'last1', key: 'ifIndex', apply: parser.decNum },
            ],
        },
    ],
}

parser.register(SECTION, DEFINITION);
