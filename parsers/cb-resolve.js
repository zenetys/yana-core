'use strict';

const parser = require('../parser.js');

const SECTION = 'cb-resolve';

const DEFINITION = {
    onSectionHeader: (ctx) => {
        if (ctx.section.length < 4)
            return false; /* error */
        if (ctx.section[3] != 'ptr')
            return null; /* ignore */
        return true;
    },
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: / domain name pointer (?<name>.+)\.$/,
            index: [
                { value: SECTION },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
            ],
            data: [
                { group: 'name', key: 'ptr' },
            ],
        },

        /* Ignore server lines and timeout coming from the host command.
         * Lines are still matched so that no log gets emitted. */
        { regex: /^(?:Using domain server|Name|Address|Aliases):|^;; / },
    ],
}

parser.register(SECTION, DEFINITION);
