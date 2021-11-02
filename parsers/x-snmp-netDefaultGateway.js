'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-netDefaultGateway';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^\.1\.3\.6\.1\.2\.1\.16\.19\.12\.0 = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            index: [
                { value: SECTION },
                { fn: (ctx, cap) => ctx.section[2] }, /* device */
            ],
            data: [
                { group: 'data', key: 'netDefaultGateway' },
            ],
        },
    ],
}

parser.register(SECTION, DEFINITION);
