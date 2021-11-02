'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-dot1d';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^\.1\.3\.6\.1\.2\.1\.17\.1\.4\.1\.2\.(?<last1>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: `${SECTION}BasePort` },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                { group: 'last1' },
            ],
            data: [
                { group: 'last1', key: 'dot1dBasePort', apply: parser.decNum },
                { group: 'data', key: 'ifIndex', apply: parser.decNum },
            ],
        },
        {
            regex: /^\.1\.3\.6\.1\.2\.1\.17\.4\.3\.1\.2\.(?<mac>\d+(\.\d+){5}) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined && cap.groups.data != '0',
            index: [
                { value: `${SECTION}TpFdb` },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                {
                    autoinc: {
                        base: [
                            { value: `${SECTION}TpFdb` },
                            { fn: (ctx, cap) => ctx.section[2] },
                        ],
                        uniq: [
                            { group: 'mac' },
                        ],
                    },
                },
            ],
            data: [
                { group: 'mac', key: 'mac', apply: parser.decOidMac },
                { group: 'data', key: 'dot1dBasePort', apply: parser.decNum },
            ],
        }
    ],
}

parser.register(SECTION, DEFINITION);
