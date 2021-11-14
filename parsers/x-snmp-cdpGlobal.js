'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-cdpGlobal';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^\.1\.3\.6\.1\.4\.1\.9\.9\.23\.1\.3(?<oid>[\d.]+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: SECTION },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
            ],
            data: [
                {
                    group: 'oid',
                    match: {
                        '.1.0': { group: 'data', key: 'cdpGlobalRun', apply: parser.decNum },
                        '.4.0': { group: 'data', key: 'cdpGlobalDeviceId' },
                        '.7.0': { group: 'data', key: 'cdpGlobalDeviceIdFormat', apply: parser.decNum },
                    },
                },
            ],
        },
    ],

    onSectionClose: (ctx) => {
        if (ctx.db[SECTION] && ctx.db[SECTION][ctx.section[2]]) {
            let o = ctx.db[SECTION][ctx.section[2]];

            if (o.cdpGlobalDeviceId !== undefined) {
                o.cdpGlobalDeviceIdDecoded = parser.decCdpDeviceId(o.cdpGlobalDeviceId,
                    o.cdpGlobalDeviceIdFormat /* may be undefined */);
            }
        }
        return true;
    },
}

parser.register(SECTION, DEFINITION);
