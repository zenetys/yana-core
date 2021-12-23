'use strict';

const builder = require('./builder.js');
const cache = require('./cache.js');
const Logger = require('./logger.js');
const util = require('./util.js');
const log = new Logger('dbhelpers');

function countSfdbMacs(macs /* expected format sfdb.<did>.<ifname> */) {
    let seen = {};
    let count = 0;
    for (let i = 0; i < macs.length; i++) {
        if (!seen[macs[i].mac]) {
            seen[macs[i].mac] = 1;
            count++;
        }
    }
    return count;
}

function getDeviceBestName(db, did, stripDom) {
    let name = getDeviceName(db, did, stripDom);
    if (name)
        return name;
    let ip = getDeviceIp(db, did);
    if (ip)
        return ip;
    let mac = getDeviceMac(db, did);
    if (mac)
        return mac;
    return did;
}

/* Current implementation returns the first IP of the device from
 * the sdevice table. */
function getDeviceIp(db, did, first = true) {
    var ip = util.oget(db, ['sdevice', did, 'ip']);
    if (ip && ip.length > 0) {
        return first ? ip[0] : ip;
    }
    return undefined;
}

function getDeviceIpsFromMac(db, did, mac, opts = {}) {
    var uniq = {};
    var oif = util.oget(db, ['device', did, 'iface']);
    if (oif) {
        for (let ifname in oif) {
            if (!oif[ifname].mac || !oif[ifname].ip)
                continue;
            let ifMac = builder.datalistValues(oif[ifname].mac);
            if (!ifMac)
                continue;
            for (let e of ifMac) {
                if (e == mac) {
                    let ifIp = builder.datalistValues(oif[ifname].ip);
                    if (!ifIp)
                        continue;
                    for (let i of ifIp) {
                        let slash = i.indexOf('/');
                        if (slash != -1)
                            i = i.substr(0, slash);
                        uniq[i] = i;
                    }
                }
            }
        }
    }
    return opts.object ? uniq : Object.keys(uniq);
}

/* Current implementation returns the first mac of the device from
 * the sdevice table. */
function getDeviceMac(db, did) {
    var mac = util.oget(db, ['sdevice', did, 'mac']);
    if (mac && mac.length > 0)
        return mac[0];
    return undefined;
}

function getDeviceMacs(db, did, opts = {}) {
    var mac = util.oget(db, ['device', did, 'mac']);
    mac = mac ? builder.datalistValues(mac) : [];
    if (opts.object)
        return mac.reduce((r, e) => { r[e] = e; return r; }, {});
    return mac;
 }

function getDeviceMacsFromIface(db, did, opts = {}) {
    var oif = util.oget(db, ['device', did, 'iface']);
    if (!oif)
        return undefined;
    var uniq = {};
    for (let ifname in oif) {
        if (!oif[ifname].mac || (opts.filter && !opts.filter(ifname, oif[ifname])))
            continue;
        let mac = builder.datalistValues(oif[ifname].mac);
        for (let e of mac)
            uniq[e] = e;
    }
    return opts.object ? uniq : Object.keys(uniq);
}

/* Current implementation returns the first name of the device from
 * the sdevice table. */
function getDeviceName(db, did, stripDom) {
    var name = util.oget(db, ['sdevice', did, 'name']);
    if (name && name.length > 0)
        return stripDom ? stripDomain(name[0]) : name[0];
    return undefined;
}

function getMacsVendors(mac, opts = {}) {
    var ouiDb = cache.getOuiDb();
    var vendor = {};
    if (!Array.isArray(mac))
        mac = [mac];
    for (let m of mac) {
        let v = ouiDb[m.substr(0, 8)];
        if (v)
            vendor[v] = 1;
    }
    if (opts.object)
        return vendor;
    return Object.keys(vendor);
}

/* @param did: Device id from which to get neighbors (required).
 * @param ifname: Optional device ifname to focus on.
 * @param filterNormCapability: Optional array of normCapability keys to filter.
 */
function getNei(db, did, ifname, filterNormCapability) {
    var out = [];

    function processIfaceNeiArray(neiArray) {
        for (let n of neiArray) {
            let capability = util.oget(db.sdevice, [n.id, 'capability']);
            let normed = normCapability(capability);
            if (filterNormCapability &&
                Object.keys(normed).every((e) => filterNormCapability.indexOf(e) == -1))
                continue;
            n = util.clone(n); /* read-only database */
            n.capability = capability;
            n.normCapability = normed;
            n.normCapabilityType = normCapabilityType(normed);
            out.push(n);
        }
    }

    if (ifname) {
        let result = util.oget(db.snei, [did, ifname]);
        if (result)
            processIfaceNeiArray(result);
    }
    else {
        let result = util.oget(db.snei, [did]);
        if (result) {
            for (let ifname in result)
                processIfaceNeiArray(result[ifname]);
        }
    }

    return out;
}

function getFdb(db, did, ifname) {
    var out = [];
    var fdb = util.oget(db.sfdb, [did, ifname]);
    if (fdb) {
        fdb = util.ogroup(fdb, (k, v) => v.mac);
        for (let mac in fdb) {
            let d = {};
            d.mac = mac;
            d.id = util.oget(db.ualias, ['device', 'mac', d.mac]);
            d.vlan = {};
            for (let entry of fdb[mac])
                d.vlan[entry.vlan] = entry.vlan
            d.vlan = Object.keys(d.vlan);
            d.vlan.sort();
            out.push(d);
        }
    }
    return out;
}

/* @param capability: Array of capability names
 * For convience this function checks if <capability> is an array, it
 * returns an empty normalization if it is not. */
function normCapability(capability) {
    var out = {};
    if (Array.isArray(capability)) {
        let ocap = capability.reduce((r, c) => (r[c] = true, r), {});
        if (ocap['telephone'] || ocap['voip-phone'])
            out['telephone'] = true;
        else if (ocap['wlanAccessPoint'] || ocap['tb-bridge'])
            out['wlanAccessPoint'] = true;
        else {
            if (ocap['bridge'] || ocap['switch'])
                out['switch'] = true;
            if (ocap['router'])
                out['router'] = true;
        }
    }
    return out;
}

function normCapabilityType(ocap) {
    if (ocap.telephone)
        return 'telephone';
    else if (ocap.wlanAccessPoint)
        return 'wlanAccessPoint';
    else if (ocap.switch)
        return ocap.router ? 'l2/l3 switch' : 'l2 switch';
    else if (ocap.router)
        return 'router';
    return undefined;
}

function shortIfname(name) {
    var cap = /[0-9/.]+$/.exec(name);
    if (cap != null) {
        let left = name.substr(0, cap.index).toLowerCase();
        let right = name.substr(cap.index);
        if (left == 'fastethernet')
            return `Fa${right}`;
        if (left == 'gigabitethernet')
            return `Gi${right}`;
        if (left == 'tengigabitethernet')
            return `Te${right}`;
        if (left == 'port-channel')
            return `Po${right}`;
        if (left == 'ethernet')
            return `Eth${right}`;
    }
    return name;
}

function stripDomain(name) {
    var dot = name.indexOf('.');
    if (dot > 0) /* use 0 instead of -1, so we do not make an empty name */
        return name.substr(0, dot);
    return name;
}

module.exports = {
    countSfdbMacs,
    getDeviceBestName,
    getDeviceIp,
    getDeviceIpsFromMac,
    getDeviceMac,
    getDeviceMacs,
    getDeviceMacsFromIface,
    getMacsVendors,
    getDeviceName,
    getFdb,
    getNei,
    normCapability,
    normCapabilityType,
    shortIfname,
    stripDomain,
};
