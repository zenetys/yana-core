'use strict';

const builder = require('../builder.js');
const config = require('../config.js');
const cache = require('../cache.js');
const handler = require('../handler.js');
const Logger = require('../logger.js');
const util = require('../util.js');

const fs = require('fs');
const path = require('path');

const OPTIONS = {
    log: new Logger('handler:swspecs'),
    contentType: 'application/json',
    inputRules: {
        urlParams: {
            type: 'array',
            min: 1,
            max: 1,
            elems: {
                type: 'string',
                check: (x) => x.length > 0 && x.indexOf('.') != 0,
            },
        },
        qs: {
            type: 'object',
            fields: {
                database: {
                    type: 'string',
                    check: (x) => x.length > 0 && x.indexOf('.') != 0,
                },
                id: {
                    type: 'string',
                    check: (x) => x.length > 0,
                    required: true,
                },
            },
        },
    },
};


const createConfig = (device) => {
    const switches = {};

    Object.keys(device.iface).forEach((iface, i) => {
        const { prefix, suffix } = getPrefixNSuffix(iface, iface.length);
        const { port, mod, nswitch } = getPortModSwitch(suffix);

        const { operStatus, name } = device.iface[iface];

        if (!switches[prefix]) {
            switches[prefix] = [];
        }
        if (!switches[prefix][nswitch]) {
            switches[prefix][nswitch] = [];
        }
        if (!switches[prefix][nswitch][mod]) {
            switches[prefix][nswitch][mod] = [];
        }
        if(switches[prefix][nswitch][mod]) {
            const index = Number(port);
            switches[prefix][nswitch][mod].push({ index, operStatus, name: name[0] });
        }
    })
    const types = Array.isArray(device.type) ? device.type : [ device.type ];
    const description = device.description[0] ? device.description[0] : device.description;
    const { swmodels, swconfig, swvendors } = readConfigFile();

    const swbrand = getSwitchBrand(swvendors, types, description);
    const swmodel = getSwitchModel(types, description);

    const res = [];

    const maxLength = getMaxPortLength(switches);
    const defaultConfig = getDefaultConfig(swconfig, swbrand, maxLength);
    const knownConfig = swmodels[swmodel] || null;
    const config = knownConfig || defaultConfig;
    const isDefault = knownConfig ? false : true;
    if (config && config.length > 0) {
        const ports = getPorts(config, switches);
        //checkPorts(config, ports);
        res.push({ config, ports, isDefault });
    }

    return res;
}

const getPrefixNSuffix = (str, length) => {
    let counter = 1;
    for (let i = length - 1;!isNaN(str[--i]) || str[i] === '/' ;) {
        counter++;
    }

    const prefix = str.slice(0, length - counter);
    const suffix = str.slice(length - counter).trim();
    return { prefix, suffix };
}


const getPortModSwitch = (suffix) => {
    const range = suffix.split('/');
    let port = 0;
    let mod = 0;
    let nswitch = 0;
    switch (range.length) {
            case 1:
                port = range[0];
                break;
            case 2:
                mod = range[0];
                port = range[1];
                break;
            case 3:
                nswitch = range[0];
                mod = range[1]
                port = range[2];
                break;
    }

    return { port, mod, nswitch };
}

const getPorts = (config, groups) => {
    const ports = {};
    config.forEach((el) => {
        if (!ports[el.prefix]) {
            ports[el.prefix] = [];
            groups[el.prefix].forEach(group => {
                ports[el.prefix].push(group);
            })
        }
    })

    return ports;
}

const getDefaultConfig = (swconfig, swbrand, plength) => {

    const brand = swbrand === 'unknown' ? 'cisco' : swbrand;
    /* DEFAULT CASE */
    if (plength > 28) {
        const config = swconfig[`${brand}-default-48`];
        return config ? config : [];
    }
    if (plength > 16) {
        const config = swconfig[`${brand}-default-24`];
        return config ? config : [];
    }
    else {
        const config = swconfig[`${brand}-default-12`];
        return config ? config : [];
    }
}

const getMaxPortLength = (switches) => {
    let length = 0;
    Object.keys(switches).forEach((iface) => {
        switches[iface].forEach((ports) => {
            if (ports.length > 0) {
                const maxLength = max(ports.map(port => port.index));
                if (maxLength > length) {
                    length = maxLength;
                }
            }
        })
    });
    return length;
}

const max = (ports) => {
        let i = 0;
        let max = 0;
        while (i < ports.length) {
            if (!isNaN(ports[i])) {
                if (ports[i] > max) {
                    max = ports[i];
                }
            }
            i++;
        }

        return max;
    }

const getSwitchModel = (types, description) => {
    if(!types) {
        return "";
    }

    const myRe = new RegExp("[A-Z0-9]+(?:-[A-Z0-9]*)+");
    let result = "";
    types.forEach(type => {
        const match = myRe.exec(type);

        if (match) {
            result = match[0];
        }
    });

    /*
    const match = myRe.exec(description);
    if (match) {
        result = match[0];
    }
    */

    return result.toLowerCase();
}

const getSwitchBrand = (vendors, types, description) => {
    let brand = 'unknown';
    vendors.forEach((vendor) => {
        if (description && description.toLowerCase().includes(vendor)) {
            brand = vendor;
        }
    });
    types.forEach((type, i) => {
        vendors.forEach((vendor) => {
            if (type && type.toLowerCase().includes(vendor)) {
                brand = vendor;
            }
        });
    });
    return brand;
}


const checkPorts = (config, ports) => {
    if (!config) {
        return 0;
    }
    const length = config[config.length - 1].to;
    const unknown = {
        name: 'Unknown',
        operStatus: -1,
    }

    let i = 0;

    while (i < length) {
        if (ports[i] === undefined) {
            ports[i] = {
                ...unknown,
                index: i + 1,
            }
        }
        i++;
    }
}

const readConfigFile = () => {
    try {
        const filePath = path.join(__dirname, '..', 'config.json')
        const file = fs.readFileSync(filePath, 'utf8')
        // parse JSON string to JSON object
        const data = JSON.parse(file);
        const swmodels = data['switch-templates'];
        const swconfig = data['switch-defaults'];
        const swvendors = data['switch-vendors'];
        return { swmodels, swconfig, swvendors };
    }
    catch (err) {
        console.log(`@SWSPECS: Error reading file from disk: ${err}`);
    }

    return {};
}

class HandlerSwspecs extends handler.Handler {
    constructor() {
        super(OPTIONS);
    }

    async process(ctx) {
        /* use latest database if none requested */
        if (!ctx.url.qs.database) {
            ctx.url.qs.database = cache.getLatestDbId(ctx.url.params[0]);
            if (ctx.url.qs.database instanceof Error)
                return this.headEnd(ctx, ctx.url.qs.database.code == 'ENOENT' ? 400 : 500);
            if (!ctx.url.qs.database)
                return this.headEnd(ctx, 404);
        }

        const db = await cache.getDb(ctx.url.params[0], ctx.url.qs.database);
        if (!db)
            return this.headEnd(ctx, db === null ? 400 : 500);

        const device = db.sdevice[ctx.url.qs.id];

        if (!device)
            return this.headEnd(ctx, device === null ? 404 : 500);

        const config = createConfig(device);

        this.headEnd(ctx, 200, JSON.stringify(config));
    }
}

handler.register('GET', '/entity/*/swspecs', new HandlerSwspecs());
