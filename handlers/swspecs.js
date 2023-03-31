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

const ctx = OPTIONS.log;


const createConfig = (device) => {
    const groups = {};

    const { swsizes, swmodels, swconfig, swvendors, vlancolors } = readConfigFile();
    const { swbrand, swmodel } = getModelNBrand(device, swvendors);
    ctx.info(`[getModelNBrand] { swbrand: ${swbrand}, swmodel: ${swmodel} }`)

    const vlans = [];

    let i = 0;
    for (const vlan in device.vlan) {
        vlans.push({ vlan, color: vlancolors[i] });
        i++;
    }

    for (const iface in device.iface) {
        if (iface === "GigabitEthernet0/0") {
            continue;
        }
        const { prefix, suffix } = getPrefixNSuffix(iface, iface.length);
        const { port, mod, nswitch } = getPortModSwitch(suffix);

        const { operStatus, name, pvlan } = device.iface[iface];
        const obj = pvlan ?
            vlans.find(({ vlan }) => { if(pvlan == vlan) return true } )
            : '';

        if (!groups[prefix]) {
            groups[prefix] = [];
        }
        if (!groups[prefix][nswitch]) {
            groups[prefix][nswitch] = [];
        }
        if (!groups[prefix][nswitch][mod]) {
            groups[prefix][nswitch][mod] = [];
        }
        if(groups[prefix][nswitch][mod]) {
            const index = Number(port);
            groups[prefix][nswitch][mod][index - 1] = ({ index, operStatus, name: name[0], color: obj ? obj.color : '', pvlan });
        }
    }

    const SIZES = swsizes;

    const switches = discoverSwitches(groups);
    const identified = identifySwitches(switches, SIZES);


    const res = [];

    switches.forEach((slot, nswitch) => {
        //const maxLength = getMaxPortLength(slot);

        //const defaultConfig = getDefaultConfig(swconfig, swbrand, maxLength);
        const defaultConfig = guessDefaultConfig(swconfig, swbrand, identified[nswitch], SIZES);

        const knownConfig = swmodels[swmodel] || null;

        const config = getConfig(knownConfig, defaultConfig);

        const isDefault = knownConfig ? false : true;
        if (config && config.length > 0) {
            const groups = getPorts(createGroups(config, swconfig), slot);

            //checkPorts(config, groups);
            res.push({ groups, isDefault });
        }
    })

    return res;
}

/**
 * Compares the two configs and try to preserve ports,
 * it will always give reason to the knownConfig if a confilct between two groups occurs
 *
 * @param {knownConfig, defConfig} - both configs are as:
 *                  { template: 'cisco-default-24', prefix: 'Giga', mod: '0' }
 * @returns {Array} - An array of groups like { numerotation: 'up-down', ... prefix, mod}
 */
const getConfig = (knownConfig, defConfig) => {
    if (knownConfig === null) {
        return defConfig;
    }

    const config = [];
    for (let i = 0; i < knownConfig.length || i < defConfig.length; i++) {
        const knownGroup = knownConfig[i];
        const defGroup = defConfig[i];

        // it will always give reason to the knownConfig
        // execpt if no config is found
        // that is how we deal for it for now
        // TODO: Search a better way if needed ?
        if (!knownGroup) {
            config.push(defGroup);
        } else {
            config.push(knownGroup);
        }

    }

    return config;
}


/**
 * Create the groups neccessary to ZSwitch to represent one switch
 * gets a config like { template: 'cisco-default-24', prefix: 'Giga', mod: '0' }
 * and builds groups like { numerotation: 'up-down', ... prefix, mod}
 * refer to the config json switch templates for more details
 *
 * @param {config} - config as { template: 'cisco-default-24', prefix: 'Giga', mod: '0' }
 * @returns {Arrray} - An array of groups like { numerotation: 'up-down', ... prefix, mod}
 */
const createGroups = (config, swconfig) => {
    const groups = [];

    config.forEach(slot => {
        const defaultConfig = swconfig[slot.template] || [];

        const prefix = slot.prefix;
        const mod = slot.mod;
        defaultConfig.forEach((group) => {
            groups.push({ ...group, prefix, mod  })
        })
    });

    return groups;
}

/**
 * Adds ports to the config groups
 *
 * @param {groups, slot} - config groups and the slot of the switch containing the ports
 * @returns {Arrray} - An array of groups with the ports as
 *                     { numerotation, ports, prefix, mod ... }
 */
const getPorts = (groups, slot) => {
    const res = [];
    const log = [];

    groups.forEach((group, i) => {
        if (group.prefix && slot[group.prefix]) {
            const mod = group.mod || 0;

            const ports = checkPorts(group, slot[group.prefix][mod]).slice(group.from - 1, group.to);
            const numerotation = group.numerotation;
            const oneline = group.oneline;
            const type = group.type;
            const sfp = group.sfp;

            log.push(`${i}: { numerotation: ${numerotation}, type: ${type}, sfp: ${sfp}, oneline: ${oneline} }`);
            res.push({ numerotation, type, ports, sfp, oneline });
        }
    })


    ctx.info(`[getPorts] res:\n${log.join('\n')}\n`);
    return res;
}

const discoverSwitches = (groups) => {
    const res = [];
    const log = [];

    for (const prefix in groups) {
        if (prefix.toLowerCase().includes('bluetooth') || prefix.toLowerCase().includes('vlan') || prefix.toLowerCase().includes('stack') || prefix.toLowerCase() === "port-channel") {
            continue;
        }
        const sw = groups[prefix];
        sw.forEach((group, nswitch) => {
            group.forEach((ports, mod) => {
                if (ports.length > 1) {
                    if (!res[nswitch]) res[nswitch] = {};
                    if (!res[nswitch][prefix]) res[nswitch][prefix] = [];
                    res[nswitch][prefix][mod] = ports;

                    log.push(`${nswitch}: { prefix: ${prefix}, length: ${ports.length} }`);
                }
            })
        })
    }

    ctx.info(`[discoverSwitches] switches:\n${log.join('\n')}\n`);

    return res;
}

const identifySwitches = (switches, sizes) => {
    const identified = {};
    const log = [];

    switches.forEach((slot, nswitch) => {
        Object.keys(slot).forEach((prefix) => {
            if (!identified[nswitch]) {
                identified[nswitch] = [];
            }
            const group = slot[prefix];

            group.forEach((ports, mod) => {
                const length = max(ports.map(port => port.index));
                const defaultSize = sizes.reduce((prev, curr) => {
                    const res = (Math.abs(curr - length) < Math.abs(prev - length) ? curr : prev);
                    return length < res + 1 ? res : 0;
                });

                log.push(`${nswitch}: { prefix: ${prefix}, length: ${length}, defaultSize: ${defaultSize} }`);
                identified[nswitch].push({ prefix, mod, length: defaultSize });
            });
        });
    });

    ctx.info(`[identifySwitches] identified:\n${log.join('\n')}\n`);
    return identified;
}

const guessDefaultConfig = (swconfig, swbrand, identified, sizes) => {
    const defaultConfig = [];

    identified.forEach(group => {
        const template = getDefaultConfig(swconfig, swbrand, group.length, sizes);

        const prefix = group.prefix;
        const mod = group.mod;

        defaultConfig.push({ prefix, mod, template})
    });

    return defaultConfig;
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

const getDefaultConfig = (swconfig, swbrand, plength, sizes) => {
    const brand = swbrand === 'unknown' ? 'cisco' : swbrand;

    let i = sizes.findIndex(el => el === plength);
    let length = sizes[i];
    let item = swconfig[`${brand}-default-${length}`];
    while (!item && i < sizes.length - 1) {
        length = sizes[i++];
        item = swconfig[`${brand}-default-${length}`];
    }

    if (i > sizes.length - 1) {
        ctx.error(`[ERROR] No config found ${plength}`)
        return null;
    }

    ctx.info(`[getDefaultConfig] ${brand}-default-${length}`)
    return `${brand}-default-${length}`;
}

const getMaxPortLength = (slot) => {
    let length = 0;


    Object.keys(slot).forEach((prefix, i) => {
        slot[prefix].forEach((ports, mod) => {
            if (ports.length > 0) {
                const maxLength = max(ports.map(port => port.index));
                if (maxLength > length) {
                    length = maxLength;
                }
            }
        })
    })

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

const getModelNBrand = (device, swvendors) => {
    const types = Array.isArray(device.type) ? device.type : [ device.type ];
    const description = device.description[0] ? device.description[0] : device.description;

    const swbrand = getSwitchBrand(swvendors, types, description);
    const swmodel = getSwitchModel(types, description);

    return { swbrand, swmodel };
}

const getSwitchModel = (types, description) => {
    if(!types) {
        return "";
    }

    const desc = description.split(' ');

    const myRe = new RegExp("[A-Z0-9]+(?:-[A-Z0-9]*)+");
    let result = "";
    desc.forEach((word) => {
        const match = myRe.exec(word);

        if (match && result === '') {
            result = match[0];
        }
    });

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


const checkPorts = (configGroup, ports) => {
    if (!configGroup || !ports) {
        return [];
    }
    const length = configGroup.to;
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

    return ports;
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
        const swsizes = data['switch-sizes'];
        const vlancolors = data['vlan-colors'];
        return { swsizes, swmodels, swconfig, swvendors, vlancolors };
    }
    catch (err) {
        ctx.error(`[readConfigFile] Error reading file from disk: ${err}`);
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
