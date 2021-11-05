'use strict';

const builder = require('../builder.js');
const util = require('../util.js');

const DEFINITION = {
    comment: 'build short fdb table',
    fn: run,
    spec: {
        '*': {
            '*': {
                '@': {
                    sort: util.makeCmpMultiFn([
                        { fn: builder.makeCmpOriginPrio([ 'snmp' ]) },
                    ]),
                    uniq: true,
                },
            },
        },
    },
};

function run(ctx, def) {
    ctx.db.sfdb = builder.simplify(ctx.db.fdb, def.spec);
    return true;
}

builder.register(610, DEFINITION);
