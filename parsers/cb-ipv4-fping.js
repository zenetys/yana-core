'use strict';

const parser = require('../parser.js');

const SECTION = 'cb-ipv4-fping';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

//    rules: [
//        {
//            regex: /^(?<ip>\d+(\.\d+){3}) is alive/,
//            index: [
//                { value: SECTION },
//                { group: 'ip' },
//            ],
//            data: [
//                { group: 'ip', key: 'ip' },
//                { value: true, key: 'alive' },
//            ],
//        },
//    ],
    rules: [
        {
            regex: /^(?<ip>\d+(\.\d+){3}) is alive/,
            index: [
                { value: SECTION },
                { fn: (ctx, cap) => ctx.section[2] }, /* fping target */
                /* target may be a network address */
            ],
            data: [
                { fn: (ctx, cap) => ({ [cap.groups.ip]: true }) },
            ],
        },
    ],
}

parser.register(SECTION, DEFINITION);
