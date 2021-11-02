'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-arp';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            /* Found at least one device missing the ifIndex part of the OID */
            regex: /^(?<oid>(\.\d+){10})(\.(?<ifIndex>\d+))?\.(?<ip>\d+(\.\d+){3}) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            fn: (ctx, cap) => {
                if (cap.groups.data == '00 00 00 00 00 00 ' ||
                    cap.groups.data == 'FF FF FF FF FF FF ')
                    return null; /* ignore */
                if (cap.groups.ifIndex === undefined)
                    cap.groups.ifIndex = '-1';
                return true;
            },

            index: [
                { value: SECTION },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                {
                    autoinc: {
                        base: [
                            { value: SECTION },
                            { fn: (ctx, cap) => ctx.section[2] },
                        ],
                        uniq: [
                            { group: 'ifIndex' },
                            { group: 'ip' },
                        ],
                    },
                },
            ],
            data: [
                { group: 'ifIndex', key: 'ifIndex', filter: (v) => v != '-1', apply: parser.decNum },
                { group: 'ip', key: 'ip' },
                {
                    group: 'oid',
                    match: {
                        '.1.3.6.1.2.1.4.22.1.2': { key: 'mac', group: 'data', apply: parser.decHexStringMac },
                    },
                },
            ],
        },
    ],
}

parser.register(SECTION, DEFINITION);
