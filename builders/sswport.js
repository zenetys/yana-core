'use strict';

const builder = require('../builder.js');
const util = require('../util.js');

const DEFINITION = {
    comment: 'build short swport table',
    fn: run,
    spec: {
        '*': {
            '*': {
                '*': {
                    '@': {
                        sort: util.makeCmpMultiFn([
                            { fn: builder.makeCmpOriginPrio([ 'snmp' ]) },
                        ]),
                        fn: (dlva) => dlva[0] /* first */
                    },
                },
            },
        },
    },
};

function run(ctx, def) {
    ctx.db.sswport = builder.simplify(ctx.db.swport, def.spec);
    return true;
}

builder.register(630, DEFINITION);
