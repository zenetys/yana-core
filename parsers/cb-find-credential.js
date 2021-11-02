'use strict';

const parser = require('../parser.js');

const SECTION = 'cb-find-credential';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 4,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^(?<key>[^\s]+)\s*=\s*(?<value>.+)$/,
            index: [
                { value: SECTION },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
                { fn: (ctx, cap) => ctx.section[3] }, /* credential type */
            ],
            data: [
                { fn: (ctx, cap) => ctx.section[3], key: 'type' },
                { fn: (ctx, cap) => { return { [cap.groups.key]: cap.groups.value }; } },
            ],
        },
    ],
}

parser.register(SECTION, DEFINITION);
