'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-vlanTrunkPort';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^\.1\.3\.6\.1\.4\.1\.9\.9\.46\.1\.6\.1\.1(?<oid>\.\d+)\.(?<last1>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
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
                        '.5': { group: 'data', key: 'vlanTrunkPortNativeVlan', apply: parser.decNum },
                        '.13': { group: 'data', key: 'vlanTrunkPortDynamicState', apply: parser.decNum },
                        '.14': { group: 'data', key: 'vlanTrunkPortDynamicStatus', apply: parser.decNum },

                        /* All vlanTrunkPortVlansEnabled* properties get decoded and merged
                         * to a single vlanTrunkPortVlansEnabledDecoded property on section close. */
                        '.4': { group: 'data', key: 'vlanTrunkPortVlansEnabled' },
                        '.17': { group: 'data', key: 'vlanTrunkPortVlansEnabled2k' },
                        '.18': { group: 'data', key: 'vlanTrunkPortVlansEnabled3k' },
                        '.19': { group: 'data', key: 'vlanTrunkPortVlansEnabled4k' },
                    },
                },
            ],
        },
        {
            regex: /^/,
            filter: () => false,
        },
    ],

    onSectionClose: (ctx) => {
        if (ctx.db[SECTION] && ctx.db[SECTION][ctx.section[2]]) {
            let o = ctx.db[SECTION][ctx.section[2]];
            for (let i in o) {
                if (!o[i].vlanTrunkPortVlansEnabled)
                    continue;

                try {
                    o[i].vlanTrunkPortVlansEnabledDecoded = parser.decCiscoVlansEnabled(
                        o[i], 'vlanTrunkPortVlansEnabled');
                }
                catch (e) {
                    ctx.log.error(`Could not decode vlanTrunkPortVlansEnabled from ${ctx.section[2]}.`, e);
                }
            }
        }
        return true;
    },
}

parser.register(SECTION, DEFINITION);
