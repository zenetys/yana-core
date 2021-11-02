'use strict';

const parser = require('../parser.js');

const SECTION = 'x-snmp-pagpGroup';

const DEFINITION = {
    onSectionHeader: (ctx) => ctx.section.length >= 3,
    onSectionData: parser.parseRegex,

    rules: [
        {
            regex: /^\.1\.3\.6\.1\.4\.1\.9\.9\.98\.1\.1\.1\.1\.8\.(?<last1>\d+) = ((?<type>[^:]+): (?<data>.+)|"")$/,
            filter: (ctx, cap) => cap.groups.data !== undefined,
            fn: (ctx, cap) => {
                if (cap.groups.data == '0' ||
                    cap.groups.data == cap.groups.last1)
                    return null;

                return {
                    [SECTION]: {
                        [ctx.section[2]]: {
                            [cap.groups.last1]: {
                                ifIndex: parser.decNum(cap.groups.last1),
                                pagpGroupIfIndex: parser.decNum(cap.groups.data),
                            },
                        },
                    },
                };
            },
        },
    ],
}

parser.register(SECTION, DEFINITION);
