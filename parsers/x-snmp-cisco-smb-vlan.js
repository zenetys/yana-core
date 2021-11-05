'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-cisco-smb-vlan';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^\.1\.3\.6\.1\.4\.1\.9\.6\.1\.101\.48(?<oid>\.\d+)\.1\.1\.(?<last1>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
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
                        '.22': { group: 'data', key: 'vlanPortModeState', filter: (v) => v != '0', apply: parser.decNum },
                        '.61': { group: 'data', key: 'vlanTrunkPortModeNativeVlanId', filter: (v) => v != '0', apply: parser.decNum },
                        '.62': { group: 'data', key: 'vlanAccessPortModeVlanId', filter: (v) => v != '0', apply: parser.decNum },
                        '.63': { group: 'data', key: 'vlanCustomerPortModeVlanId', filter: (v) => v != '0', apply: parser.decNum },
                    },
                },
            ],
        },
    ],
}

parser.register(SECTION, DEFINITION);
