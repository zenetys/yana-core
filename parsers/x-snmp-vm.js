'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-vm';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^\.1\.3\.6\.1\.4\.1\.9\.9\.68\.1\.2\.2\.1(?<oid>\.\d+)\.(?<last1>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: SECTION },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                { group: 'last1' },
            ],
            data: [
                { group: 'last1', key: 'ifIndex', apply: parser.decNum },
                {
                    group: 'oid',
                    match: {
                        '.1': { group: 'data', key: 'vmVlanType', apply: parser.decNum },
                        '.2': { group: 'data', key: 'vmVlan', apply: parser.decNum },

                        /* All vmVlans* properties get decoded and merged
                         * to a single vmVlansDecoded property on section close. */
                        '.4': { group: 'data', key: 'vmVlans' },
                        '.5': { group: 'data', key: 'vmVlans2k' },
                        '.6': { group: 'data', key: 'vmVlans3k' },
                        '.7': { group: 'data', key: 'vmVlans4k' },
                    },
                },
            ],
        },
    ],

    onSectionClose: (ctx) => {
        if (ctx.db[SECTION] && ctx.db[SECTION][ctx.section[2]]) {
            let o = ctx.db[SECTION][ctx.section[2]];
            for (let i in o) {
                if (!o[i].vmVlans)
                    continue;

                try {
                    o[i].vmVlansDecoded = parser.decCiscoVlansEnabled(
                        o[i], 'vmVlans');
                }
                catch (e) {
                    ctx.log.error(`Could not decode vmVlans from ${ctx.section[2]}.`, e);
                }
            }
        }
        return true;
    },
}

parser.register(SECTION, DEFINITION);
