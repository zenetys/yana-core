'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-if';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^\.1\.3\.6\.1\.2\.1\.2\.2\.1(?<oid>\.\d+)\.(?<last1>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
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
                        '.2': { key: 'ifDescr', group: 'data', apply: parser.decHexString },
                        '.5': { key: 'ifSpeed', group: 'data', filter: (v) => v != '0', apply: parser.decNum },
                        '.6': {
                            key: 'ifPhysAddress',
                            group: 'data',
                            /* some windows 6to4 interfaces return an hw
                             * address like 00 00 00 00 00 00 00 E0 */
                            filter: (v) => v.length == 18 && v != '00 00 00 00 00 00 ',
                            apply: parser.decHexStringMac,
                        },
                        '.7': { key: 'ifAdminStatus', group: 'data', apply: parser.decNum },
                        '.8': { key: 'ifOperStatus', group: 'data', apply: parser.decNum },
                    },
                },
            ],
        },
    ],
}

parser.register(SECTION, DEFINITION);

// FIXME: ignore lo, how? onSectionDone() sur le parser ?
// FIXME: vaut mieux exécuter un callback depuis onNscanClose pour trouver
// FIXME: toutes les interfaces dont l'ip est du 127.* => remove
// FIXME: ça permettrait de ne pas se limiter au nom "lo" spécifique linux

// FIXME: exclude ifSpeed 0 et 4294967295000000
