'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-cdpCache';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^\.1\.3\.6\.1\.4\.1\.9\.9\.23\.1\.2\.1\.1(?<oid>[\d.]+)\.(?<last2>\d+)\.(?<last1>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
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
                            { group: 'last2' },
                            { group: 'last1' },
                        ],
                    },
                },
            ],
            data: [
                { group: 'last2', key: 'ifIndex', apply: parser.decNum },
                {
                    group: 'oid',
                    match: {
                        '.3': { group: 'data', key: 'cdpCacheAddressType', apply: parser.decNum },
                        '.4': { group: 'data', key: 'cdpCacheAddress' },
                        '.5': { group: 'data', key: 'cdpCacheVersion', apply: parser.decHexString },
                        '.6': { group: 'data', key: 'cdpCacheDeviceId', apply: parser.decHexString },
                        '.7': { group: 'data', key: 'cdpCacheDevicePort', apply: parser.decHexString },
                        '.8': { group: 'data', key: 'cdpCachePlatform', apply: parser.decHexString },
                        '.9': { group: 'data', key: 'cdpCacheCapabilities', apply: parser.decHexNum },
                        '.10': { group: 'data', key: 'cdpCacheVTPMgmtDomain', apply: parser.decHexString },
                        '.11': { group: 'data', key: 'cdpCacheNativeVLAN', filter: (x) => x != '0', apply: parser.decNum },
                        '.12': { group: 'data', key: 'cdpCacheDuplex', apply: parser.decNum },
                        '.15': { group: 'data', key: 'cdpCachePowerConsumption', apply: parser.decNum },
                    },
                },
            ],
        },
    ],

    onSectionClose: (ctx) => {
        if (ctx.db[SECTION] && ctx.db[SECTION][ctx.section[2]]) {
            let o = ctx.db[SECTION][ctx.section[2]];
            for (let i in o) {
                if (o[i].cdpCacheAddressType !== undefined && o[i].cdpCacheAddress !== undefined)
                    o[i].cdpCacheAddressDecoded = parser.decCdpAddress(o[i].cdpCacheAddress, o[i].cdpCacheAddressType);
                if (o[i].cdpCacheCapabilities !== undefined)
                    o[i].cdpCacheCapabilitiesNames = parser.decCdpCap(o[i].cdpCacheCapabilities);
            }
        }
        return true;
    },
}

parser.register(SECTION, DEFINITION);
