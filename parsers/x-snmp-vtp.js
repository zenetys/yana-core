'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-vtp';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            /* Assume there is only one domain, so skip the domainId and index by vlanId.
             * This may be wrong but looks like it's not! */
            regex: /^\.1\.3\.6\.1\.4\.1\.9\.9\.46\.1\.3\.1\.1\.4\.(?<domainId>\d+)\.(?<vlanId>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: `${SECTION}Vlan` },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                { group: 'vlanId' },
            ],
            data: [
                { group: 'vlanId', key: 'vlanId', apply: parser.decNum },
                { group: 'data', key: 'vlanName', apply: parser.decHexString },
            ],
        },
        {
            /* Same assumption on VTP management domains, assume unique.  */
            regex: /^\.1\.3\.6\.1\.4\.1\.9\.9\.46\.1\.2\.1\.1(?<oid>\.\d+)\.(?<domainId>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: `${SECTION}Domain` },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
            ],
            data: [
                {
                    group: 'oid',
                    match: {
                        '.2': { group: 'data', key: 'domainName', apply: parser.decHexString },
                        '.3': { group: 'data', key: 'domainLocalMode', apply: parser.decNum },
                        '.4': { group: 'data', key: 'domainConfigRevNumber', apply: parser.decNum },
                        '.5': { group: 'data', key: 'domainLastUpdater' },
                        '.6': {
                            group: 'data',
                            key: 'domainLastChange',
                            filter: (v) => v != '00 00 01 01 00 00 00 00 ' &&
                                           v != '07 D0 00 00 00 00 00 00 ',
                            apply: parser.decHexDate,
                        },
                        '.10': { group: 'data', key: 'domainPruningState', apply: parser.decNum },
                        '.11': { group: 'data', key: 'domainVersionInUse', apply: parser.decNum },
                        '.12': { group: 'data', key: 'domainPruningStateOper', apply: parser.decNum },
                        '.19': { group: 'data', key: 'domainDeviceId', apply: parser.decHexString }, /* vtp version 3 */
                    },
                },
            ],
        },
    ],
}

parser.register(SECTION, DEFINITION);
