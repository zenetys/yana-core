'use strict';

const builder = require('../builder.js');
const util = require('../util.js');

const DEFINITION = {
    comment: 'build short rfdb table',
    fn: run,
    spec: {
        '*': {
            '@': {
                sort: util.makeCmpMultiFn([
                    { fn: builder.makeCmpOriginPrio([ 'snmp' ]) },
                ]),
                uniq: true,
            },
        },
    },
};

function run(ctx, def) {
    ctx.db.srfdb = builder.simplify(ctx.db.rfdb, def.spec);
    return true;
}

builder.register(620, DEFINITION);
