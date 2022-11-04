'use strict';

const builder = require('../builder.js');
const dbhelpers = require('../dbhelpers.js');
const util = require('../util.js');

const DEFINITION = {
    comment: 'build main tables',
    fn: run,
};

/* Helpers */

/* Standalone helper that do not need context (ctx). */

function isBadDeviceIp(ip, prefix) {
    /* 127.0.0.0/8 */
    if (ip.substr(0, 4) == '127.')
        return true;
    /* mostly for 0.0.0.0 that can be seen but also for buggy devices that
     * report 0.something addresses.  */
    if (ip.substr(0, 2) == '0.')
        return true;

    if (prefix !== undefined) {
        /* multicast */
        if ((ip == '224.0.0.0' && prefix == 4) ||
            (ip == '239.0.0.0' && prefix == 8) ||
            (ip == '255.255.255.255' && prefix == 32))
            return true;
    }

    return false;
}

function getNetworkPrefix(mask) {
    if (mask === undefined)
        return 32;

    const c = { "255": 8, "254": 7, "252": 6, "248": 5,
                "240": 4, "224": 3, "192": 2, "128": 1, "0": 0 }

    var p = 0;
    for (let m of mask.split('.'))
        p += c[m];
    return p;
}

function getBroadcastIP(ip, pfx) {
    var mask = [];
    for (let i = 0; i < 4; i++) {
        let n = Math.min(pfx, 8);
        mask.push(256 - Math.pow(2, 8 - n));
        pfx -= n;
    }
    var bcast = ip.split('.').map((e, i) => (~mask[i] & 0xff) | e);
    return bcast.join('.')
}

/* Context (ctx) helpers. */

/* "add" helpers". We check for undefined value from these functions for
 * better readability in callers. */

function addDeviceIp(ctx, did, ip, origin) {
    if (ip === undefined || isBadDeviceIp(ip))
        return false;
    ctx.addDatalist('device', [did, 'ip'], builder.datalist(ip, origin));
    ctx.ualias(['device', 'ip', ip], did);
    ctx.malias(['device', 'ip', ip], did);
    return true;
}

function addDeviceName(ctx, did, name, origin) {
    if (name === undefined)
        return false;
    ctx.addDatalist('device', [did, 'name'], builder.datalist(name, origin));
    ctx.ualias(['device', 'name', name], did);
    ctx.malias(['device', 'name', name], did);
    return true;
}

function addDeviceMac(ctx, did, mac, ifname, origin) {
    if (mac === undefined)
        return false;
    ctx.addDatalist('device', [did, 'mac'], builder.datalist(mac, origin));
    ctx.ualias(['device', 'mac', mac], did);
    ctx.malias(['device', 'mac', mac], did);
    if (ifname !== undefined)
        ctx.addDatalist('device', [did, 'iface', ifname, 'mac'], builder.datalist(mac, origin));
    return true;
}

function addDeviceProp(ctx, did, path, value, origin) {
    if (value === undefined)
        return false;
    ctx.addDatalist('device', [did, ...path], builder.datalist(value, origin));
    return true;
}

function addSwportProp(ctx, did, ifname, path, value, origin) {
    if (value === undefined)
        return false;
    ctx.addDatalist('swport', [did, ifname, ...path], builder.datalist(value, origin));
    return true;
}

function getIfname(ctx, did, ifalias, failureHint) {
    if (!Array.isArray(ifalias))
        ifalias = [ifalias];
    let ifname;
    for (let i of ifalias) {
        if (i !== undefined) {
            ifname = ctx.get('ualias', ['iface', did, i]);
            if (ifname !== undefined)
                return ifname;
        }
    }
    if (failureHint)
        ctx.log.warning(`device ${did}, no interface matching alias [${ifalias}], ${failureHint}`);
    return undefined;
};

function getIfnameWithGuess(ctx, did, ifalias, failureHint) {
    const moreAlias = {
        fa: [ 'FastEthernet', 'Fa' ],
        gi: [ 'GigabitEthernet', 'Gi' ],
        te: [ 'TenGigabitEthernet', 'Te', '10GE' ],
        twe: [ 'TwentyFiveGigE', 'Twe' ],
        fo: [ 'FortyGigabitEthernet', 'Fo', '40GE' ],
        hu: [ 'HundredGigabitEthernet', 'Hu', '100GE' ],
        po: [ 'Port-Channel', 'port-channel', 'Po' ],
    };
    if (!Array.isArray(ifalias))
        ifalias = [ifalias];
    for (let i = 0, len = ifalias.length; i < len; i++) {
        if (ifalias[i] === undefined)
            continue;
        let ret = /[0-9/.]+$/.exec(ifalias[i]);
        if (ret != null) {
            let pfx = ifalias[i].substr(0, ret.index).toLowerCase();
            if (moreAlias[pfx]) {
                for (let ma of moreAlias[pfx])
                    ifalias.push(ma + ret[0]);
            }
        }
    }
    return getIfname(ctx, did, ifalias, failureHint);
};

function addIfname(ctx, did, names, aliases, origin) {
    /* try if exists, in which case the function will add potential new
     * names and aliases */
    let ifname = getIfname(ctx, did, [...names, ...aliases]);
    for (let i = 0; i < names.length; i++) {
        if (names[i] === undefined)
            continue; /* skip undefined */
        if (ifname === undefined)
            ifname = names[i];
        ctx.addDatalist('device', [did, 'iface', ifname, 'name'],
            builder.datalist(names[i], origin));
        ctx.ualias(['iface', did, names[i]], ifname);
    }
    if (ifname !== undefined && aliases) {
        for (let i of aliases) {
            if (i !== undefined) /* skip undefined */
                ctx.ualias(['iface', did, i], ifname);
        }
    }
    return ifname;
}

function computeIfAgg(ctx, o) {
    let rType = {
        member: 'memberOf',
        memberOf: 'member',
    }
    for (let did in o) {
        for (let i in o[did]) {
            let e = o[did][i];
            if (e.type == 'ifalias') {
                let iname = getIfname(ctx, did, i, `cannot compute interface aggregate`);
                if (iname === undefined) {
                    delete o[did][i];
                    continue;
                }
                util.omerge(o[did], { [iname]: { member: e.member, memberOf: e.memberOf } });
                delete o[did][i];
                e = o[did][iname];
                i = iname;
            }
            delete e.type;
            for (let t of Object.keys(rType)) {
                for (let origin in e[t]) {
                    for (let ii in e[t][origin]) {
                        let ee = e[t][origin][ii];
                        if (ee.type == 'ifalias') {
                            let iiname = getIfname(ctx, did, ii, `cannot compute interface aggregate`);
                            if (iiname === undefined) {
                                delete e[t][origin][ii];
                                continue;
                            }
                            util.omerge(e[t][origin], { [iiname]: {} })
                            delete e[t][origin][ii];
                            ee = e[t][origin][iiname];
                            ii = iiname;
                        }
                        delete ee.type;
                        util.omerge(o[did], { [ii]: { [rType[t]]: { [origin]: { [i]: {} } } } });
                    }
                    if (util.oempty(e[t][origin]))
                        delete e[t][origin];
                }
            }
        }
    }
}

/* Find out if an arp entry can be trusted or if it should be ignored.
 *
 * - Ignore some IP, either irrelevant, malformed due to bugs, dodgy arp entries
 *   with self mac and a 127.0.0.0/8 address, 169.254.0.0/16 addresses because
 *   this can cause unwanted devices merges, etc.
 *
 * - If a device do not have a default gateway and there is proxy arp on the
 *   network, that device may have IP/mac arp entries with the mac of the proxy
 *   arp. We do not want to attach these IP addresses to the proxy arp device.
 *   Some ideas to handle that:
 *   - Ignore arp entries with IP addresses not on the same network as
 *     the IP addresses of the device.
 *   - Ignore arp entries that would attach an IP address on a device
 *     that has complete IP data. Adding a new one would be a mistake
 *     since we already know all its IP addresses.
 */
function isArpAcceptable(ctx, did, arpIp, arpMac, didFromIp, didFromMac) {
    /* bad ip */
    if (isBadDeviceIp(arpIp))
        return false;
    if (arpIp.substr(0, 8) == '169.254.')
        return false;

    /* proxy arp */
    /* Tentative 1: ignore if the device has no default gateway.
     * Disabled as we had at least one case were it caused legitimate ARP
     * entries to be ignored. */
    // var routes = util.oget(ctx.db.device, [ did, 'route' ]);
    // if (routes) {
    //     routes = builder.datalistValues(routes, {
    //         filter: (d) => builder.dataValue(d).dest == '0.0.0.0/0',
    //     });
    //     if (!routes.some((r) => r.via && r.via != '0.0.0.0'))
    //         return false; /* no default gateway */
    // }

    /* Tentative 2: ignore if the device corresponding to the arpMac
     * has complete IP data. Assume this is the case if the device has
     * x-snmp-ipAdEnt data. */
    if (didFromMac) {
        var ips = util.oget(ctx.db.device, [ didFromMac, 'ip' ]);
        if (ips) {
            ips = builder.datalistValues(ips, {
                filter: (d) => builder.dataOrigin(d) == 'x-snmp-ipAdEnt',
            });
            if (ips.length > 0)
                return false; /* already has complete IP data */
        }
    }
    return true;
}

/* route, arp, fdb */

function processRouteEntry(ctx, did, v, t) {
    let r = {};
    let ips = getDeviceIps(ctx, did);
    let ipsPrefix = getDeviceIfaceIpsPrefix(ctx, did);
    let ipsBcast = {};
    for (let ip in ipsPrefix)
        ipsBcast[getBroadcastIP(ip, ipsPrefix[ip])] = 1;

    if (v.dest) {
        let pfx;
        if (v.pfxLen !== undefined)
            pfx = v.pfxLen;
        else if (v.mask !== undefined)
            pfx = getNetworkPrefix(v.mask);
        else
            return; /* mask or prefix required */
        if (((v.dest != '0.0.0.0' || pfx != 0) && isBadDeviceIp(v.dest, pfx)) ||
            ips.indexOf(v.dest) != -1 || ipsBcast[v.dest])
            return;
        r.dest = `${v.dest}/${pfx}`;
    }

    if (v.nextHop && v.nextHop != '0.0.0.0' && ips.indexOf(v.nextHop) == -1)
        r.via = v.nextHop;

    if (v.metric1 !== undefined)
        r.metric = v.metric1;

    if (v.ifIndex !== undefined) {
        let ifname = getIfname(ctx, did, `_snmp_ifIndex_${v.ifIndex}`, 'cannot complete route entry');
        if (ifname !== undefined)
            r.iface = ifname;
    }

    addDeviceProp(ctx, did, ['route'], r, t);
}

function processArpEntry(ctx, did, v, t, delayNewDevices) {
    let didFromIp = ctx.ualias(['device', 'ip', v.ip]);
    let didFromMac = ctx.ualias(['device', 'mac', v.mac]);

    if (!isArpAcceptable(ctx, did, v.ip, v.mac, didFromIp, didFromMac))
        return true;

    if (didFromIp && didFromMac) {
        if (ctx.db.device[didFromIp].id != ctx.db.device[didFromMac].id) {
            ctx.addToResolve({ arp: { did, entry: v, table: t, didFromIp, didFromMac }, comment: `arp entry ` +
                `on did ${did}, ip=${v.ip} did ${didFromIp}, mac=${v.mac} did ${didFromMac}` });
            return true;
        }
    }
    else if (didFromIp) {
        ctx.log.debug2(`device ${did} has arp entry for ip ${v.ip}, found device ${didFromIp}, add mac ${v.mac}`);
        addDeviceMac(ctx, didFromIp, v.mac, undefined, `${t}-external`);
    }
    else if (didFromMac) {
        ctx.log.debug2(`device ${did} has arp entry with mac ${v.mac}, found device ${didFromMac}, add ip ${v.ip}`);
        addDeviceIp(ctx, didFromMac, v.ip, `${t}-external`);
    }
    else {
        if (delayNewDevices) {
            ctx.log.debug2(`device ${did} has arp entry for ip ${v.ip} with mac ${v.mac}, no device found, delay processing`);
            return false;
        }
        ctx.log.debug2(`device ${did} has arp entry for ip ${v.ip} with mac ${v.mac}, no device found, add new`);
        let newDid = ctx.addDevice('ip', v.ip, `${t}-external`);
        addDeviceIp(ctx, newDid, v.ip, `${t}-external`);
        addDeviceMac(ctx, newDid, v.mac, undefined, `${t}-external`);
    }

    return true;
}

function processFdbEntry(ctx, did, ifname, mac, /* undefined for dot1d */ vlan, table) {
    let didFromMac = ctx.get('ualias', ['device', 'mac', mac]);
    if (!didFromMac) {
        ctx.log.debug2(`device ${did} has fdb entry with mac ${mac}, no device found, add new`);
        didFromMac = ctx.addDevice('mac', mac, `${table}-external`);
        addDeviceMac(ctx, didFromMac, mac, undefined, `${table}-external`);
    }

    if (vlan) {
        ctx.addDatalist('fdb', [did, ifname], builder.datalist({ mac, vlan }, table));
        ctx.addDatalist('rfdb', [mac], builder.datalist({ did, ifname, vlan }, table));
    }
    else {
        ctx.addDatalist('fdb', [did, ifname], builder.datalist({ mac }, table));
        ctx.addDatalist('rfdb', [mac], builder.datalist({ did, ifname }, table));
    }
}

/* switchport normalization */

function normalizeDot1qSwport(ctx, did, ifname) {
    var out = {};

    var kSwport = [
        'dot1qPvid',
        'dot1qEgressVlans',
        'dot1qUntaggedVlans',
    ];
    var decSwport = {
        '*': {
            '@': {
                format: false, /* _data structures */
                fn: (da) => da[0], /* first */
            },
        }
    };
    var dSwport = builder.simplify(
        util.okeys(ctx.get('swport', [ did, ifname ]), kSwport),
        decSwport);

    if (dSwport.dot1qPvid)
        out.pvlan = dSwport.dot1qPvid;

    /* untagged may be empty, but not egress otherwise there is no
     * untagged/tagged vlan data to return */
    if (dSwport.dot1qEgressVlans) {
        let egressList = builder.dataValue(dSwport.dot1qEgressVlans);
        let untaggedList = dSwport.dot1qUntaggedVlans ? builder.dataValue(dSwport.dot1qUntaggedVlans) : [];
        let origin = builder.dataOrigin(dSwport.dot1qEgressVlans); /* not so correct, but will do it */
        let tagged = []; /* computed to be stored */
        let untagged = []; /* computed to be stored */

        for (let i = 0; i < egressList.length; i++) {
            if (untaggedList.indexOf(egressList[i]) == -1)
                tagged.push(egressList[i]);
            else
                untagged.push(egressList[i]);
        }
        untagged.sort(util.cmpDefault);
        tagged.sort(util.cmpDefault);
        out.untagged = builder.data((util.Ranges.fromArray(untagged)).get(), origin);
        out.tagged = builder.data((util.Ranges.fromArray(tagged)).get(), origin);

        if (untagged.length > 1)
            out.swPortMode = builder.data(builder.SW_PORT_MODE_DOT1Q_LIKE_GENERAL, origin);
        else if (tagged.length > 0)
            out.swPortMode = builder.data(builder.SW_PORT_MODE_DOT1Q_LIKE_TRUNK, origin);
        else if (dSwport.dot1qPvid) {
            /* switch HP, trunk-like port seen with pvid "none"  */
            if (untagged.length == 1 && builder.dataValue(dSwport.dot1qPvid) == untagged[0])
                out.swPortMode = builder.data(builder.SW_PORT_MODE_DOT1Q_LIKE_ACCESS, origin);
            else /* 1 untagged vlan != pvid */
                out.swPortMode = builder.data(builder.SW_PORT_MODE_DOT1Q_LIKE_GENERAL, origin);
        }
        /* else cannot guesspont */
    }

    return out;
}

function normalizeCiscoSmbSwport(ctx, did, ifname) {
    var out = {};

    var kSwport = [
        'ciscoSmbVlanPortModeState',
        'ciscoSmbVlanAccessPortModeVlanId',
        'ciscoSmbVlanTrunkPortModeNativeVlanId',
        'ciscoSmbVlanCustomerPortModeVlanId',
    ];
    var decSwport = {
        '*': {
            '@': {
                format: false, /* _data structures */
                fn: (da) => da[0], /* first */
            },
        }
    };
    var dSwport = builder.simplify(util.okeys(ctx.get('swport', [ did, ifname ]), kSwport), decSwport);

    var vMode, oMode;
    if (dSwport.ciscoSmbVlanPortModeState) {
        vMode = builder.dataValue(dSwport.ciscoSmbVlanPortModeState);
        oMode = builder.dataOrigin(dSwport.ciscoSmbVlanPortModeState);
    }

    if (vMode == 1 || vMode == 10 || /* general */
        vMode == 3 || vMode == 12) { /* trunk */
        if (vMode == 1 || vMode == 10) {
            out.swPortMode = builder.data(builder.SW_PORT_MODE_GENERAL, oMode);
            /* pvlan, untagged, tagged, can use dot1q data */
        }
        else {
            out.swPortMode = builder.data(builder.SW_PORT_MODE_TRUNK, oMode);
            if (dSwport.ciscoSmbVlanTrunkPortModeNativeVlanId) {
                out.pvlan = dSwport.ciscoSmbVlanTrunkPortModeNativeVlanId;
                out.untagged = builder.data([
                    { from: builder.dataValue(dSwport.ciscoSmbVlanTrunkPortModeNativeVlanId),
                      to: builder.dataValue(dSwport.ciscoSmbVlanTrunkPortModeNativeVlanId) }],
                    builder.dataOrigin(dSwport.ciscoSmbVlanTrunkPortModeNativeVlanId));
            }
            /* tagged, can use dot1q data */
        }
    }
    else if (vMode == 2 || vMode == 11) {
        out.swPortMode = builder.data(builder.SW_PORT_MODE_ACCESS, oMode);
        if (dSwport.ciscoSmbVlanAccessPortModeVlanId) {
            out.pvlan = dSwport.ciscoSmbVlanAccessPortModeVlanId;
            out.untagged = builder.data([
                { from: builder.dataValue(dSwport.ciscoSmbVlanAccessPortModeVlanId),
                  to: builder.dataValue(dSwport.ciscoSmbVlanAccessPortModeVlanId) }],
                builder.dataOrigin(dSwport.ciscoSmbVlanAccessPortModeVlanId));
            out.tagged = builder.data([], oMode);
        }
    }
    else if (vMode == 7 || vMode == 15) {
        out.swPortMode = builder.data(builder.SW_PORT_MODE_CUSTOMER, oMode);
        if (dSwport.ciscoSmbVlanCustomerPortModeVlanId) {
            out.pvlan = dSwport.ciscoSmbVlanCustomerPortModeVlanId;
            out.untagged = builder.data([
                { from: builder.dataValue(dSwport.ciscoSmbVlanCustomerPortModeVlanId),
                  to: builder.dataValue(dSwport.ciscoSmbVlanCustomerPortModeVlanId) }],
                builder.dataOrigin(dSwport.ciscoSmbVlanCustomerPortModeVlanId));
            out.tagged = builder.data([], oMode);
        }
    }

    return out;
}

function normalizeCiscoSwport(ctx, did, ifname) {
    var out = {};

    var kSwport = [
        'fexIndex',
        'ciscoVlanPortIslOperStatus',
        'ciscoVlanTrunkPortDynamicState',
        'ciscoVlanTrunkPortDynamicStatus',
        'ciscoVlanTrunkPortNativeVlan',
        'ciscoVlanTrunkPortVlansEnabledDecoded',
        'ciscoVmVlan',
        'ciscoVmVlanType',
    ];
    var kIface = [
        'adminStatus',
        'operStatus',
    ];
    var decSwport = {
        '*': {
            '@': {
                format: false, /* _data structures */
                fn: (da) => da[0], /* first */
            },
        }
    };
    var decIface = {
        '*': {
            '@': {
                /* default format as data values */
                fn: (dva) => dva[0], /* first */
            },
        }
    };
    var dSwport = builder.simplify(util.okeys(ctx.get('swport', [ did, ifname ]), kSwport), decSwport);
    var vIface = builder.simplify(util.okeys(ctx.get('device', [ did, 'iface', ifname ]), kIface), decIface);

    /* swPortMode (access, trunk, auto, ...) */

    if (dSwport.fexIndex) {
        /* Interface is an uplink to a FEX module */
        out.swPortMode = builder.data(builder.SW_PORT_MODE_FEX, builder.dataOrigin(dSwport.fexIndex));
    }
    else if (dSwport.ciscoVlanTrunkPortDynamicState) {
        out.swPortMode = dSwport.ciscoVlanTrunkPortDynamicState;
    }
    else if (dSwport.ciscoVmVlanType) {
        /* Assume interface on a FEX module, vlanTrunkPortDynamicState is not available in SNMP. */
        let v = builder.dataValue(dSwport.ciscoVmVlanType);
        if (v == 1 || v == 2)
            out.swPortMode = builder.data(builder.SW_PORT_MODE_ACCESS, builder.dataOrigin(dSwport.ciscoVmVlanType));
        else if (v == 3)
            out.swPortMode = builder.data(builder.SW_PORT_MODE_TRUNK, builder.dataOrigin(dSwport.ciscoVmVlanType));
    }

    var vSwPortMode = out.swPortMode ? builder.dataValue(out.swPortMode) : undefined;

    /* swPortStatus (trunking, not trunking) */

    if (dSwport.ciscoVlanTrunkPortDynamicStatus &&
        vSwPortMode != builder.SW_PORT_MODE_FEX) {
        out.swPortStatus = (dSwport.ciscoVlanPortIslOperStatus &&
            builder.dataValue(dSwport.ciscoVlanTrunkPortDynamicStatus) == builder.SW_PORT_STATUS_NOT_TRUNKING &&
            builder.dataValue(dSwport.ciscoVlanPortIslOperStatus) == builder.SW_PORT_STATUS_TRUNKING)
                ? dSwport.ciscoVlanPortIslOperStatus
                : dSwport.ciscoVlanTrunkPortDynamicStatus;
    }

    var vSwPortStatus = out.swPortStatus ? builder.dataValue(out.swPortStatus) : undefined;

    /* pvlan, untagged, tagged */

    /* Normalize pvlan, untagged, tagged if the information is doubtless.
     * If a port is dynamic (auto) and down we cannot know what configuration
     * would be applied on the port if it was to come up. */
    if (dSwport.ciscoVlanTrunkPortNativeVlan &&
        dSwport.ciscoVlanTrunkPortVlansEnabledDecoded &&
        (vSwPortMode == builder.SW_PORT_MODE_TRUNK ||
         vSwPortMode == builder.SW_PORT_MODE_TRUNK_NO_NEGO ||
         (vIface.adminStatus == builder.IF_STATUS_UP &&
          vIface.operStatus == builder.IF_STATUS_UP &&
          vSwPortStatus == builder.SW_PORT_STATUS_TRUNKING))) {

        out.pvlan = dSwport.ciscoVlanTrunkPortNativeVlan;
        out.untagged = builder.data(
            [{ from: builder.dataValue(dSwport.ciscoVlanTrunkPortNativeVlan),
               to: builder.dataValue(dSwport.ciscoVlanTrunkPortNativeVlan) }],
            builder.dataOrigin(dSwport.ciscoVlanTrunkPortNativeVlan));

        let r = new util.Ranges(builder.dataValue(dSwport.ciscoVlanTrunkPortVlansEnabledDecoded));
        r.remove(builder.dataValue(dSwport.ciscoVlanTrunkPortNativeVlan));
        out.tagged = builder.data(r.get(), builder.dataOrigin(dSwport.ciscoVlanTrunkPortVlansEnabledDecoded));
    }
    else if (dSwport.ciscoVmVlan &&
             (vSwPortMode == builder.SW_PORT_MODE_ACCESS ||
              (vIface.adminStatus == builder.IF_STATUS_UP &&
               vIface.operStatus == builder.IF_STATUS_UP &&
               vSwPortStatus == builder.SW_PORT_STATUS_NOT_TRUNKING))) {

        out.pvlan = dSwport.ciscoVmVlan;
        out.untagged = builder.data(
            [{ from: builder.dataValue(dSwport.ciscoVmVlan),
               to: builder.dataValue(dSwport.ciscoVmVlan) }],
            builder.dataOrigin(dSwport.ciscoVmVlan));
        out.tagged = builder.data([], 'snmp-cisco-access-no-tag');
    }

    return out;
}

/* neighbors */

function getDidFromAlias(ctx, type /* mac, ip, name */, value) {
    let result = ctx.get('malias', ['device', type, value]);
    return result ? Object.keys(result) : [];
};

function getIfaceFromMac(ctx, did, mac) {
    let ifaces = ctx.get('device', [did, 'iface']);
    for (let i in ifaces) {
        let dl = ctx.get('device', [did, 'iface', i, mac]);
        if (dl) {
            let macs = builder.datalistValues(dl);
            for (let m of macs) {
                if (m == mac)
                    return i;
            }
        }
    }
    return undefined;
};

function processSnmpLldpNeiEntry(ctx, did, ifname, o) {
    /* try to find an existing device */
    let neiDid, neiDidSource, dids;
    let chassisMac, chassisIp, chassisName;
    let toResolve = (msg) => ctx.addToResolve({ lldp: { did, ifname, nei: o },
        comment: `lldp nei entry on did ${did} ifname ${ifname}, ${msg}` });

    let sysNameMac;

    if (/^SEP[0-9A-F]{12}$/.test(o.sysName)) {
        /* some phones advertise a name as SEP<MAC> with their mac address
         * in uppercase without separator between bytes */
        sysNameMac = o.sysName.substr(3).toLowerCase().replace(/(..)/g, ':$1').substr(1);
    }

    if (o.chassisIdDecoded) {
        if (o.chassisIdSubtype == 4) { /* macAddress */
            chassisMac = o.chassisIdDecoded;
            dids = getDidFromAlias(ctx, 'mac', o.chassisIdDecoded);
        }
        else if (o.chassisIdSubtype == 5) { /* networkAddress */
            chassisIp = o.chassisIdDecoded;
            dids = getDidFromAlias(ctx, 'ip', o.chassisIdDecoded);
        }
    }
    if (dids) {
        if (dids.length > 1) {
            toResolve(`could not confirm nei did from chassis (subtypes mac, ip) between ${JSON.stringify(dids)}`);
            return;
        }
        else if (dids.length == 1) {
            neiDid = dids[0];
            neiDidSource = 'chassis (subtypes mac, ip)';
        }
    }
    if (sysNameMac) {
        dids = getDidFromAlias(ctx, 'mac', sysNameMac);
        if (dids.length > 1) {
            toResolve(`could not confirm nei did from sysNameMac between ${JSON.stringify(dids)}`);
            return;
        }
        else if (dids.length == 1) {
            if (neiDid) {
                if (dids[0] != neiDid) {
                    toResolve(`sysNameMac did ${dids[0]} conflicts with did ${neiDid} from ${neiDidSource}`);
                    return;
                }
            }
            else {
                neiDid = dids[0];
                neiDidSource = 'sysNameMac';
            }
        }
    }
    if (o.manAddr) {
        dids = getDidFromAlias(ctx, 'ip', o.manAddr);
        if (dids.length > 1) {
            toResolve(`could not confirm nei did from manAddr between ${JSON.stringify(dids)}`);
            return;
        }
        else if (dids.length == 1) {
            if (neiDid) {
                if (dids[0] != neiDid) {
                    toResolve(`manAddr did ${dids[0]} conflicts with did ${neiDid} from ${neiDidSource}`);
                    return;
                }
            }
            else {
                neiDid = dids[0];
                neiDidSource = 'manAddr';
            }
        }
    }

    /* as a last chance we can try to get a nei did by name, but the name
     * is more suject to duplicates. */
    if (!neiDid) {
        if (o.chassisIdDecoded && o.chassisIdSubtype == 7) { /* local, generally a name */
            chassisName = o.chassisIdDecoded;
            dids = getDidFromAlias(ctx, 'name', o.chassisIdDecoded);
            if (dids.length > 1) {
                toResolve(`could not confirm nei did from chassis (subtype local) between ${JSON.stringify(dids)}`);
                return;
            }
            else if (dids.length == 1) {
                neiDid = dids[0];
                neiDidSource = 'chassis (subtype local)';
            }
        }
        if (o.sysName) {
            dids = getDidFromAlias(ctx, 'name', o.sysName);
            if (dids.length > 1) {
                toResolve(`could not confirm nei did from sysName between ${JSON.stringify(dids)}`);
                return;
            }
            else if (dids.length == 1) {
                if (neiDid) {
                    if (dids[0] != neiDid) {
                        toResolve(`sysName did ${dids[0]} conflicts with did ${neiDid} from ${neiDidSource}`);
                        return;
                    }
                }
                else {
                    neiDid = dids[0];
                    neiDidSource = 'sysName';
                }
            }
        }
    }

    /* if not found, create new device */
    if (!neiDid) {
        if (chassisMac)
            neiDid = ctx.addDevice('mac', chassisMac, 'x-snmp-lldpRem-external');
        else if (chassisIp)
            neiDid = ctx.addDevice('ip', chassisIp, 'x-snmp-lldpRem-external');
        else if (o.manAddr)
            neiDid = ctx.addDevice('ip', o.manAddr, 'x-snmp-lldpRem-external');
        else {
            toResolve('not enought data to get a device');
            return;
        }
    }

    /* add device information */
    addDeviceMac(ctx, neiDid, chassisMac, undefined, 'x-snmp-lldpRem-external');
    if (sysNameMac)
        addDeviceMac(ctx, neiDid, sysNameMac, undefined, 'x-snmp-lldpRem-external');
    addDeviceIp(ctx, neiDid, chassisIp, 'x-snmp-lldpRem-external');
    addDeviceIp(ctx, neiDid, o.manAddr, 'x-snmp-lldpRem-external');
    addDeviceName(ctx, neiDid, o.sysName, 'x-snmp-lldpRem-external');
    addDeviceProp(ctx, neiDid, ['description'], o.sysDesc, 'x-snmp-lldpRem-external');
    if (o.sysCapEnabledNames) {
        for (let c of o.sysCapEnabledNames)
            addDeviceProp(ctx, neiDid, ['capability'], c, 'x-snmp-lldpRem-external');
    }

    let neiIfname, neiIfname2, neiIfdesc;
    let neiIfmac;

    /* try to find an existing interface */
    if (o.portIdDecoded && o.portIdSubtype == 3) { /* macAddress */
        neiIfname = getIfaceFromMac(ctx, neiDid, o.portIdDecoded);
        neiIfmac = o.portIdDecoded;
    }
    if (neiIfname === undefined)
        neiIfname = getIfnameWithGuess(ctx, neiDid, [o.portIdDecoded, o.portDesc]);

    /* if not found, create new interface */
    if (neiIfname === undefined) {
        if (o.portIdSubtype == 3 /* macAddress */ && o.portDesc)
            neiIfname = o.portDesc;
        else {
            /* if both look like an interface name ending with the same port
             * member and/or number, retain the longuest as main interface name */
            let sfxId = /([0-9/.]+)$/.exec(o.portIdDecoded);
            let sfxDesc = /([0-9/.]+)$/.exec(o.portDesc);
            if (sfxId && sfxDesc && sfxId[1] == sfxDesc[1] && o.portDesc.length > o.portIdDecoded.length) {
                neiIfname = o.portDesc;
                neiIfname2 = o.portIdDecoded;
            }
        }
        if (!neiIfname)
            neiIfname = o.portIdDecoded;
        if (neiIfname === undefined) {
            toResolve(`nei did ${neiDid}, cannot build a name to add an interface`);
            return;
        }
        if (!neiIfdesc && o.portDesc != neiIfname)
            neiIfdesc = o.portDesc;
        neiIfname = addIfname(ctx, neiDid, [neiIfname, neiIfname2], [], 'x-snmp-lldpRem-external');
        addDeviceProp(ctx, neiDid, ['iface', neiIfname, 'description'], neiIfdesc, 'x-snmp-lldpRem-external');
    }
    if (neiIfmac)
       addDeviceMac(ctx, neiDid, neiIfmac, neiIfname, 'x-snmp-lldpRem-external');

    ctx.addDatalist('nei', [did, ifname], builder.datalist({ id: neiDid, ifname: neiIfname }, 'x-snmp-lldpRem'));
}

function processSnmpCdpNeiEntry(ctx, did, ifname, o) {
    let neiDid, dids, ip, mac, name;
    let toResolve = (msg) => ctx.addToResolve({ lldp: { did, ifname, nei: o },
        comment: `cdp nei entry on did ${did} ifname ${ifname}, ${msg}` });

    /* try to find an existing device */
    if (o.cdpCacheAddressDecoded && o.cdpCacheAddressType == 1) { /* ip */
        ip = o.cdpCacheAddressDecoded;
        dids = getDidFromAlias(ctx, 'ip', o.cdpCacheAddressDecoded);
        if (dids) {
            if (dids.length == 1)
                neiDid = dids[0];
            else if (dids.length > 1) {
                toResolve(`could not confirm nei did from cdpCacheAddress between ${JSON.stringify(dids)}`);
                return;
            }
        }
    }

    if (o.cdpCacheDeviceId) {
        /* sometimes we can guess a mac address out of the cdpCacheDeviceId */
        if (o.cdpCacheDeviceId.length == 12 && o.cdpCacheDeviceId.toLowerCase() == o.cdpCacheDeviceId) {
            /* cisco smb usually reports a mac address as a 12 lowercase chars
             * hex string without any separator between bytes */
            mac = o.cdpCacheDeviceId.replace(/(..)/g, ':$1').substr(1);
        }
        else if (/^SEP[0-9A-F]{12}$/.test(o.cdpCacheDeviceId)) {
            /* some phones advertise a name as SEP<MAC> with their mac address
             * in uppercase without separator between bytes */
            mac = o.cdpCacheDeviceId.substr(3).toLowerCase().replace(/(..)/g, ':$1').substr(1);
            name = o.cdpCacheDeviceId;
        }
        else
            name = o.cdpCacheDeviceId;
    }

    if (!neiDid) {
        dids = undefined;
        if (mac)
            dids = getDidFromAlias(ctx, 'mac', mac);
        else if (name) {
            /* as a last chance we can try to get a nei did by name, but the name
             * is more suject to duplicates. */
            dids = getDidFromAlias(ctx, 'name', o.cdpCacheDeviceId);
        }
        if (dids) {
            if (dids.length == 1)
                neiDid = dids[0];
            else if (dids.length > 1) {
                toResolve(`could not confirm nei did from cdpCacheDeviceId between ${JSON.stringify(dids)}`);
                return;
            }
        }
    }

    /* if not found, create new device */
    if (!neiDid) {
        if (mac)
            neiDid = ctx.addDevice('mac', mac, 'x-snmp-cdpCache-external');
        else if (ip)
            neiDid = ctx.addDevice('ip', ip, 'x-snmp-cdpCache-external');
        else {
            toResolve('not enought data to get a device');
            return;
        }
    }

    /* add device information */
    addDeviceMac(ctx, neiDid, mac, undefined, 'x-snmp-cdpCache-external');
    addDeviceIp(ctx, neiDid, ip, 'x-snmp-cdpCache-external');
    if (name)
        addDeviceName(ctx, neiDid, name, 'x-snmp-cdpCache-external');
    addDeviceProp(ctx, neiDid, ['type'], o.cdpCachePlatform, 'x-snmp-cdpCache-external');
    addDeviceProp(ctx, neiDid, ['description'], o.cdpCacheVersion, 'x-snmp-cdpCache-external');

    if (o.cdpCacheCapabilitiesNames) {
        for (let c of o.cdpCacheCapabilitiesNames)
            addDeviceProp(ctx, neiDid, ['capability'], c, 'x-snmp-cdpCache-external');
    }

    /* try to find an existing interface */
    let neiIfname = getIfname(ctx, neiDid, o.cdpCacheDevicePort) ||
        getIfnameWithGuess(ctx, neiDid, o.cdpCacheDevicePort);

    /* if not found, create new interface */
    if (neiIfname === undefined)
        neiIfname = addIfname(ctx, neiDid, [o.cdpCacheDevicePort], [], 'x-snmp-cdpCache-external');

    ctx.addDatalist('nei', [did, ifname], builder.datalist({ id: neiDid, ifname: neiIfname }, 'x-snmp-cdpCache'));
}

/* conflicts */

function getDeviceIps(ctx, did) {
    let dl = ctx.get('device', [did, 'ip']);
    /* may have dups because of origin */
    return dl ? builder.datalistValues(dl) : [];
}

function getDeviceIfaceIpsPrefix(ctx, did) {
    let out = {};
    let iface = ctx.get('device', [did, 'iface']);
    for (let i in iface) {
        if (iface[i].ip) {
            let dl = builder.datalistValues(iface[i].ip);
            for (let ip of dl) {
                let slash = ip.indexOf('/');
                let pfx;
                if (slash > -1)
                    out[ip.substr(0, pfx)] = Number(ip.substr(slash + 1));
                else
                    out[ip] = 32;
            }
        }
    }
    return out;
}

function guessIfVirtualIP(ctx, did1, did2, ip) {
    let ips1 = getDeviceIfaceIpsPrefix(ctx, did1);
    let ips2 = getDeviceIfaceIpsPrefix(ctx, did2);
    /* FIXME: need cisco standby addresses to do that correctly */
    return (ips1[ip] == 32 && ips2[ip] == 32);
}

function guessIfSameDeviceForMerge(ctx, did1, did2) {
    ctx.log.debug4(`guessIfSameDeviceForMerge: did1 ${did1}, did2 ${did2}`);

    /* Current implementation assumes two devices should be merged
     * if they share at least one mac, with exception to handle
     * Cisco FEX modules. */
    const excludeListOpts = {
        object: true,
        filter: (ifname, oif) => {
            let cap = /^Ethernet(1[0-9]{2})/.exec(ifname);
            if (cap) {
                let id = Number(cap[1]);
                return id >= 101 && id <= 199;
            }
            return false;
        },
    };
    const sharedMacBlacklist = [
        '00:05:9a:3c:7a:00', // cisco anyconnect vpn client
        '00:50:56:c0:00:01', // vmware player vmnet1
        '00:50:56:c0:00:08', // vmware player vmnet8
        '00:a0:c6:00:00:00', // possibly bogus qualcomm firmware
        '02:00:4e:43:50:49', // ncp secure client virtual ndis6 adapter
        '02:80:37:ec:02:00', // ericsson 3g modem?
        '0a:00:27:00:00:00', // vboxnet0, partial? vboxnet1 mac+1, etc.
        '20:41:53:59:4e:ff', // special mac on windows? ras async adapter
        '24:b6:20:52:41:53', // kaspersky anti-virus ndis miniport
        '33:50:6f:45:30:30', // wan miniport pppoe on windows
        '50:50:54:50:30:30', // wan miniport pptp on windows
        'd2:0a:2d:a0:04:be', // fireware?
        'd2:6b:25:2f:2c:e7', // fireware?
        'e2:e6:16:20:0a:35', // fireware?
        '00:0b:ca:fe:00:00', // juniper bme0?
    ];

    let decision = false;
    let mac1 = dbhelpers.getDeviceMacs(ctx.db, did1, { object: true });
    ctx.log.debug4('guessIfSameDeviceForMerge: did1/mac', mac1);
    if (mac1) {
        let mac2 = dbhelpers.getDeviceMacs(ctx.db, did2, { object: true });
        ctx.log.debug4('guessIfSameDeviceForMerge: did2/mac', mac2);
        if (mac2) {
            let shared = {};
            for (let m1 in mac1) {
                if (mac2[m1])
                    shared[m1] = m1;
            }
            if (!util.oempty(shared)) {
                /* build an exclude list, if possible, to be able to discard
                 * some special cases */
                let exclude = dbhelpers.getDeviceMacsFromIface(ctx.db, did1, excludeListOpts);
                for (let ex in exclude)
                    delete shared[ex];
                exclude = dbhelpers.getDeviceMacsFromIface(ctx.db, did2, excludeListOpts);
                for (let ex in exclude)
                    delete shared[ex];
                for (let ex of sharedMacBlacklist)
                    delete shared[ex];
                ctx.log.debug4('guessIfSameDeviceForMerge: shared macs after exclusions', shared);
                decision = !util.oempty(shared);
            }
        }
    }
    ctx.log.debug4(`guessIfSameDeviceForMerge: did1 ${did1}, did2 ${did2} => ${decision}`);
    return decision;
}

/* merge <did2> into <did2> */
function mergeDevice(ctx, did1, did2) {
    ctx.log.debug(`Merge device ${did2} into ${did1}`);

    function _(o1, o2) {
        Object.keys(o2).forEach((k) => {
            if (builder.isDatalist(o2[k])) {
                if (o1[k]) /* datalistAdd throws if o1[k] not a datalist */
                    builder.datalistAdd(o1[k], o2[k]);
                else
                    o1[k] = o2[k];
            }
            else if (builder.isData(o2[k])) {
                if (!o1[k]) /* keep o1[k] if set */
                    o1[k] = o2[k];
            }
            else if (util.isObject(o2[k])) {
                if (o1[k] === undefined)
                    o1[k] = o2[k];
                else if (util.isObject(o1[k]))
                    _(o1[k], o2[k]);
                /* else type mismatch, do nothing but we could throw */
            }
            else if (Array.isArray(o2[k])) {
                if (o1[k] === undefined)
                    o1[k] = o2[k];
                else if (Array.isArray(o1[k])) {
                    for (let io2 of o2[k]) {
                        if (!o1[k].some((io1) => util.eq(io1, io2))) /* not found */
                            o1[k].push(io2);
                    }
                }
                /* else type mismatch, do nothing but we could throw */
            }
            else if (o1[k] === undefined) {
                o1[k] = o2[k];
            }
            /* else don't override o1, but we could throw */
        });
        return o1;
    }
    var _ualias_device = (did1, did2) => {
        if (!ctx.db || !ctx.db.ualias || !ctx.db.ualias.device)
            return;
        util.owalk(ctx.db.ualias.device, (o, path) => {
            if (path.length == 2 && o === did2) {
                ctx.log.debug2(`_ualias_device: Replace ualias.device.${path.join('.')}, ${did2} to ${did1}`);
                util.oset(ctx.db.ualias.device, path, did1);
            }
            return true;
        });
    }
    var _ualias_iface = (did1, did2) => {
        if (!ctx.db || !ctx.db.ualias || !ctx.db.ualias.iface || !ctx.db.ualias.iface[did2])
            return;
        for (let ifalias in ctx.db.ualias.iface[did2]) {
            if (!ctx.db.ualias.iface[did1])
                ctx.db.ualias.iface[did1] = {};
            if (ctx.db.ualias.iface[did1][ifalias] === undefined) {
                ctx.log.debug2(`_ualias_iface: Set ualias.iface.${did1}.${ifalias}, ${ctx.db.ualias.iface[did2][ifalias]}`);
                ctx.db.ualias.iface[did1][ifalias] = ctx.db.ualias.iface[did2][ifalias];
            }
        }
        ctx.log.debug2(`_ualias_iface: Delete ualias.iface.${did2}`);
        delete ctx.db.ualias.iface[did2];
    }
    var _malias = (did1, did2) => {
    }
    var _rarp = (did1, did2) => {
        if (!ctx.db || !ctx.db.rarp)
            return;
        util.owalk(ctx.db.rarp, (o, path) => {
            if (path.length == 2 && o[did2]) {
                o[did1] = o[did2];
                delete o[did2];
                return 2;
            }
            return true;
        });
    }

    let od1 = util.oget(ctx.db, ['device', did1]);
    let od2 = util.oget(ctx.db, ['device', did2]);
    if (!od1 || !od2)
        return false;

    _ualias_device(did1, did2);
    _ualias_iface(did1, did2);
    _rarp(did1, did2);
    _(od1, od2);

    /* Delete the second device (merged) and its references.
     * FIXME: This is currently partially done. */
    ctx.log.warning(`Delete db entry device.${did2}`);
    delete ctx.db.device[did2];
    return true;
}

function tryResolve(ctx) {
    let resolveLoopCount = 0;
    let hasResolved = true;

    /* arp conflicts are processed only once after the loop */
    let toResolveArp = [];

    do { /* while (hasResolved) */
        let toResolve = ctx.toResolve;
        ctx.toResolve = [];
        resolveLoopCount++;
        hasResolved = false;
        ctx.log.debug(`tryResolve loop #${resolveLoopCount}`);

        /* <c> for "conflict" */
        for (let c of toResolve) {
            ctx.log.debug2(`On conflict: ${c.comment ? c.comment : JSON.stringify(c.comment)}`);

            if (c.add) {
                if (c.add.db == 'ualias') {
                    if (c.add.path[0] == 'device') {
                        let dvalue = ctx.get('device', [c.add.value]);
                        let dcurrent = ctx.get('device', [c.add.current]);
                        if (!dvalue) {
                            ctx.log.debug2(`Device ${c.add.value} not found, maybe due to earlier resolution, drop`);
                            continue;
                        }
                        if (!dcurrent) {
                            ctx.log.debug2(`Device ${c.add.current} not found, maybe due to earlier resolution, replay`);
                            ctx.ualias(c.add.path, c.add.value);
                            continue;
                        }
                        if (guessIfSameDeviceForMerge(ctx, c.add.current, c.add.value) &&
                            mergeDevice(ctx, c.add.current, c.add.value)) {
                            hasResolved = true;
                            continue;
                        }

                        if (c.add.path[1] == 'ip') {
                            if (guessIfVirtualIP(ctx, c.add.value, c.add.current, c.add.path[2])) {
                                ctx.log.debug2(`IP ${c.add.path[2]} is a VIP on devices ${c.add.current} and ${c.add.value}, drop`);
                                hasResolved = true;
                                continue;
                            }
                        }
                    }

                    ctx.log.debug2(`No specific resolution handler for this alias, replay`);
                    ctx.ualias(c.add.path, c.add.value);
                    continue;
                }

                ctx.log.debug2(`No specific resolution handler for this add operation, replay`);
                ctx.add(c.add.db, c.add.path, c.add.value);
                continue;
            }

            if (c.arp) {
                ctx.log.debug2(`Process arp conflicts later all together`);
                toResolveArp.push(c);
                continue;
            }

            ctx.log.debug2(`No resolution handler for this situation`);
            ctx.toResolve.push(c);
        }

    } while (hasResolved &&
             resolveLoopCount < 200 /* safeguard */);

    ctx.log.debug2(`Replay arp entries, pass 1`);
    let arpDelayed = [];
    for (let c of toResolveArp) {
        if (!processArpEntry(ctx, c.arp.did, c.arp.entry, c.arp.table, true /* delayNewDevices */))
            arpDelayed.push([c.arp.did, c.arp.entry, c.arp.table]);
    }
    ctx.log.debug2(`Replay arp entries, pass 2`);
    for (let args of arpDelayed)
        processArpEntry(ctx, ...args);
}

/* builder callback */

function run(ctx, def) {
    ctx.db.toResolve = ctx.toResolve;
    ctx.db.ndb = ctx.ndb;

    /* make sure these tables always exist */
    ctx.db.device = {};
    ctx.db.fdb = {};
    ctx.db.rfdb = {};
    ctx.db.nei = {};
    ctx.db.rarp = {};

    ctx.log.debug('Process cb-ipv4-fping entries');
    ctx.ntableForEach2('cb-ipv4-fping', 2, (did, k1, k2, v, t) => {
        addDeviceIp(ctx, did, k2, t);
    });

    ctx.log.debug('Process x-snmp-sys entries');
    ctx.ntableForEach1('x-snmp-sys', 1, (did, k1, v, t) => {
        addDeviceName(ctx, did, v.sysName, t);
        addDeviceProp(ctx, did, ['description'], v.sysDescr, t);
        addDeviceProp(ctx, did, ['location'], v.sysLocation, t);
        addDeviceProp(ctx, did, ['contact'], v.sysContact, t);
        if (v.sysObjectID) {
            let oidName = builder.decOidName(v.sysObjectID,
                { downTo: '.1.3.6.1.4.1', maxTries: 6 });
            addDeviceProp(ctx, did, ['type'], oidName, t);
        }
    });

    let agg = {};

    ctx.log.debug('Process x-snmp-if entries');
    ctx.ntableForEach2('x-snmp-if', 1, (did, k1, k2, v, t) => {
        let ifname = addIfname(ctx, did, [v.ifDescr, v.ifName], [`_snmp_ifIndex_${k2}`], t);
        if (ifname === undefined)
            return; /* minimum required */

        addDeviceProp(ctx, did, ['iface', ifname, 'description'], v.ifAlias, t);
        addDeviceProp(ctx, did, ['iface', ifname, 'adminStatus'], v.ifAdminStatus, t);
        addDeviceProp(ctx, did, ['iface', ifname, 'operStatus'], v.ifOperStatus, t);
        addDeviceProp(ctx, did, ['iface', ifname, 'speed'], v.ifSpeed, t);
        //addDeviceProp(ctx, did, ['iface', ifname, 'type'], v.ifType, t);
        addDeviceProp(ctx, did, ['iface', ifname, 'duplex'], v.duplexStatus, t);

        /* ifType values were real ethernet mac addresses were found:
         * 1, 6, 7, 11, 22, 24, 53, 62, 69, 117, 131, 161
         * Try to only exclude fibreChannel(56) for now because they are not
         * necessarily unique accross devices. */
        if (v.ifType === undefined || v.ifType != 56)
            addDeviceMac(ctx, did, v.ifPhysAddress, ifname, t);

        if (v.dot3adAggIfIndex !== undefined) {
            /* for later processing */
            util.omerge(agg, { [did]: { [ifname]:
                { type: 'ifname', memberOf:
                    { [t]: { [`_snmp_ifIndex_${v.dot3adAggIfIndex}`]:
                        { type: 'ifalias' } } } } } });
        }
    });

    ctx.log.debug('Process interfaces aggregates');
    ctx.ntableForEach2('x-snmp-hwTrunk', 1, (did, k1, k2, v, t) => {
        for (let m in v.hwTrunkMem) {
            /* for later processing */
            util.omerge(agg, { [did]: { [`_snmp_ifIndex_${v.hwTrunkIfIndex}`]:
                { type: 'ifalias', member:
                    { [t]: { [`_snmp_ifIndex_${v.hwTrunkMem[m].ifIndex}`]:
                        { type: 'ifalias' } } } } } });
        }
    });

    ctx.log.debug('Process switch ports');
    computeIfAgg(ctx, agg)
    for (let did in agg) {
        for (let i in agg[did]) {
            for (let t in agg[did][i]) {
                for (let origin in agg[did][i][t]) {
                    let value = Object.keys(agg[did][i][t][origin]);
                    value.sort();
                    addDeviceProp(ctx, did, ['iface', i, t], value, origin);
                }
            }
        }
    }

    ctx.log.debug('Process x-snmp-ipAdEnt entries');
    ctx.ntableForEach2('x-snmp-ipAdEnt', 1, (did, k1, k2, v, t) => {
        /* attach to device */
        if (!addDeviceIp(ctx, did, v.ip, t))
            return;
        /* attach to interface */
        if (v.ifIndex !== undefined) {
            let ifname = getIfname(ctx, did, `_snmp_ifIndex_${v.ifIndex}`, `cannot attach ip address ${v.ip}`);
            if (ifname !== undefined) {
                let ip = `${v.ip}/${getNetworkPrefix(v.mask)}`;
                addDeviceProp(ctx, did, ['iface', ifname, 'ip'], ip, t);
            }
        }
    });

    ctx.log.debug('Process cb-resolve entries');
    ctx.ntableForEach1('cb-resolve', 1, (did, k1, v, t) => {
        if (!v.ptr.startsWith(k1) &&
            !v.ptr.startsWith(k1.replaceAll('.', '-')))
            addDeviceName(ctx, did, v.ptr, t);
    });

    /* route */

    ctx.log.debug('Process x-snmp-ipRoute entries');
    ctx.ntableForEach2('x-snmp-ipRoute', 1, (did, k1, k2, v, t) => {
        processRouteEntry(ctx, did, v, t)
    });

    ctx.log.debug('Process x-snmp-inetCidrRoute entries');
    ctx.ntableForEach2('x-snmp-inetCidrRoute', 1, (did, k1, k2, v, t) => {
        processRouteEntry(ctx, did, v, t)
    });

    ctx.log.debug('Process x-snmp-netDefaultGateway entries');
    ctx.ntableForEach1('x-snmp-netDefaultGateway', 1, (did, k1, v, t) => {
        let r = { dest: '0.0.0.0/0', via: v.netDefaultGateway };
        addDeviceProp(ctx, did, ['route'], r, t);
    });

    /* arp */

    let arpDelayed = [];
    ctx.log.debug('Process x-snmp-arp entries, pass 1');
    ctx.ntableForEach2('x-snmp-arp', 1, (did, k1, k2, v, t) => {

        if (v.ifIndex)
            ctx.set('rarp', [v.ip, v.mac, did], v.ifIndex);

        if (!processArpEntry(ctx, did, v, t, true /* delayNewDevices */))
            arpDelayed.push([did, v, t]);
    });

    ctx.log.debug('Process x-snmp-arp entries, pass 2');
    for (let args of arpDelayed)
        processArpEntry(ctx, ...args);

    ctx.log.debug('Process x-snmp-dot1dBasePort entries');
    ctx.ntableForEach2('x-snmp-dot1dBasePort', 1, (did, k1, k2, v, t) => {
        let ifname = getIfname(ctx, did, `_snmp_ifIndex_${v.ifIndex}`, `cannot map dot1dBasePort ${v.dot1dBasePort}`);
        if (ifname === undefined)
            return;  /* minimum required */

        ctx.ualias(['iface', did, `_snmp_dot1dBasePort_${v.dot1dBasePort}`], ifname);
        addSwportProp(ctx, did, ifname, ['dot1qPvid'], v.dot1qPvid, t);
    });

    ctx.log.debug('Process x-snmp-cefexBinding entries');
    ctx.ntableForEach2('x-snmp-cefexBinding', 1, (did, k1, k2, v, t) => {
        let ifname = getIfname(ctx, did, `_snmp_ifIndex_${v.ifIndex}`, 'cannot attach cefex data');
        if (ifname === undefined || v.fexIndex === undefined)
            return; /* minimum required */

        /* for later switchport processing */
        addSwportProp(ctx, did, ifname, ['fexIndex'], v.fexIndex, t);
        let fexName = util.oget(ctx.ndb, ['x-snmp-cefexName', k1, v.fexIndex, 'fexName']);
        addSwportProp(ctx, did, ifname, ['fexName'], fexName, t);
    });

    ctx.log.debug('Process x-snmp-stackPort entries');
    ctx.ntableForEach2('x-snmp-stackPort', 1, (did, k1, k2, v, t) => {
        let ifname = getIfname(ctx, did, `_snmp_ifIndex_${v.ifIndex}`, 'cannot attach stackPort data');
        if (ifname === undefined)
            return; /* minimum required */

        ctx.ualias(['iface', did, `_snmp_stackPort_${k2}`], ifname);

        /* for later switchport processing */
        addSwportProp(ctx, did, ifname, ['ciscoVlanPortIslOperStatus'], v.vlanPortIslOperStatus, t);
    });

    ctx.log.debug('Process x-snmp-vm entries');
    ctx.ntableForEach2('x-snmp-vm', 1, (did, k1, k2, v, t) => {
        let ifname = getIfname(ctx, did, `_snmp_ifIndex_${v.ifIndex}`, 'cannot attach vmVlan data');
        if (ifname === undefined)
            return; /* minimum required */

        /* for later normalization of switchport processing */
        for (let p of ['vmVlanType', 'vmVlan', 'vmVlansDecoded']) {
            let pp = 'cisco' + p.charAt(0).toUpperCase() + p.substr(1);
            addSwportProp(ctx, did, ifname, [pp], v[p], t);
        }
    });

    ctx.log.debug('Process x-snmp-vlanTrunkPort entries');
    ctx.ntableForEach2('x-snmp-vlanTrunkPort', 1, (did, k1, k2, v, t) => {
        let ifname = getIfname(ctx, did, `_snmp_ifIndex_${v.ifIndex}`, 'cannot attach vlanTrunkPort data');
        if (ifname === undefined)
            return; /* minimum required */

        /* for later normalization of switchport processing */
        for (let p of ['vlanTrunkPortVlansEnabledDecoded', 'vlanTrunkPortNativeVlan',
                       'vlanTrunkPortDynamicState', 'vlanTrunkPortDynamicStatus']) {
            let pp = 'cisco' + p.charAt(0).toUpperCase() + p.substr(1);
            addSwportProp(ctx, did, ifname, [pp], v[p], t);
        }
    });

    ctx.log.debug('Process x-snmp-cisco-smb-vlan entries');
    ctx.ntableForEach2('x-snmp-cisco-smb-vlan', 1, (did, k1, k2, v, t) => {
        let ifname = getIfname(ctx, did, `_snmp_ifIndex_${v.ifIndex}`, 'cannot attach cisco smb vlan data');

        /* for later normalization of switchport processing */
        for (let p of ['vlanPortModeState', 'vlanAccessPortModeVlanId',
                       'vlanTrunkPortModeNativeVlanId', 'vlanCustomerPortModeVlanId']) {
            let pp = 'ciscoSmb' + p.charAt(0).toUpperCase() + p.substr(1);
            addSwportProp(ctx, did, ifname, [pp], v[p], t);
        }
    });

    let dot1qVlanPerDidPort = {};
    ctx.log.debug('Process x-snmp-dot1qVlan entries');
    ctx.ntableForEach2('x-snmp-dot1qVlan', 1, (did, k1, k2, v, t) => {
        let vlid = v.dot1qVlanIndex;
        ctx.addImmutableData('device', [did, 'vlan', vlid, 'id'], builder.data(vlid, t));
        ctx.ualias(['vlan', did, `_vlanId_${v.dot1qVlanIndex}`], vlid);

        if (v.dot1qVlanFdbId !== undefined)
            ctx.ualias(['vlan', did, `_fdbId_${v.dot1qVlanFdbId}`], vlid);

        if (v.dot1qVlanStaticName !== undefined)
            ctx.addDatalist('device', [did, 'vlan', vlid, 'name'], builder.datalist(v.dot1qVlanStaticName, t));

        /* for later switchport processing */
        for (let type of [['dot1qVlanCurrentEgressPorts','dot1qEgressVlans'],
                          ['dot1qVlanCurrentUntaggedPorts','dot1qUntaggedVlans']]) {
            if (v[type[0]]) {
                for (let port of v[type[0]])
                    util.opush(dot1qVlanPerDidPort, [did, port, type[1]], v.dot1qVlanIndex);
            }
        }
    });

    ctx.log.debug('Post-process x-snmp-dot1qVlan per port entries');
    for (let did in dot1qVlanPerDidPort) {
        for (let port in dot1qVlanPerDidPort[did]) {
            let ifname = getIfname(ctx, did, `_snmp_dot1dBasePort_${port}`, 'cannot attach dot1qVlan per port data');
            if (ifname !== undefined) {
                for (let type in dot1qVlanPerDidPort[did][port])
                    addSwportProp(ctx, did, ifname, [type], dot1qVlanPerDidPort[did][port][type], 'x-snmp-dot1qVlan');
            }
        }
    }

    ctx.log.debug('Process x-snmp-vtpVlan entries');
    ctx.ntableForEach2('x-snmp-vtpVlan', 1, (did, k1, k2, v, t) => {
        if (v.vlanId === undefined || (v.vlanId >= 1002 && v.vlanId <= 1005))
            return;
        ctx.addImmutableData('device', [did, 'vlan', v.vlanId, 'id'], builder.data(v.vlanId, t));
        if (v.vlanName !== undefined)
            ctx.addDatalist('device', [did, 'vlan', v.vlanId, 'name'], builder.datalist(v.vlanName, t));
    });

    let getVlanId = (did, vlalias, failureHint) => {
        let vlid = ctx.get('ualias', ['vlan', did, vlalias]);
        if (vlid === undefined)
            ctx.log.warning(`device ${did}, no vlanId matching alias ${vlalias}, ${failureHint}`);
        return vlid;
    };

    /* switch ports */

    ctx.log.debug('Process switch ports');
    let swportNormalizers = [ normalizeCiscoSwport, normalizeDot1qSwport, normalizeCiscoSmbSwport ];
    for (let did in ctx.db.swport) {
        for (let ifname in ctx.db.swport[did]) {
            for (let n of swportNormalizers) {
                let data = n(ctx, did, ifname);
                for (let p in data) {
                    let dl = builder.data2datalist(data[p]);
                    ctx.addDatalist('device', [did, 'iface', ifname, p], dl);
                }
            }
        }
    }

    /* fdb */

    ctx.log.debug('Process cb-snmp-cisco-fdb entries');
    ctx.ntableForEach2('cb-snmp-cisco-fdb', 1, (did, k1, k2, v, t) => {
        let ifname = getIfname(ctx, did, `_snmp_dot1dBasePort_${v.dot1dBasePort}`, 'cannot attach fdb data');
        if (ifname === undefined)
            return; /* minimum required */

        processFdbEntry(ctx, did, ifname, v.mac, v.vlan, t);
    });

    ctx.log.debug('Process x-snmp-dot1qTpFdb entries');
    ctx.ntableForEach2('x-snmp-dot1qTpFdb', 1, (did, k1, k2, v, t) => {
        let ifname = getIfname(ctx, did, `_snmp_dot1dBasePort_${v.dot1dBasePort}`, 'cannot attach fdb data');
        let vlid = getVlanId(did, `_fdbId_${v.dot1qFdbId}`, 'cannot attach fdb data')
        if (ifname === undefined || vlid === undefined)
            return; /* minimum required */

        processFdbEntry(ctx, did, ifname, v.mac, vlid, t);
    });

    ctx.log.debug('Process x-snmp-dot1dTpFdb entries');
    ctx.ntableForEach2('x-snmp-dot1dTpFdb', 1, (did, k1, k2, v, t) => {
        /* ignore dot1dTpFdb if dot1qTpFdb is supported on the device, in which
         * case we assume here we do not need dot1dTpFdb (maybe a mistake) */
        if (util.oget(ctx.ndb, ['x-snmp-dot1qTpFdb', k1]))
            return;

        let ifname = getIfname(ctx, did, `_snmp_dot1dBasePort_${v.dot1dBasePort}`, 'cannot attach fdb data');
        if (ifname === undefined)
            return; /* minimum required */

        processFdbEntry(ctx, did, ifname, v.mac, undefined, t);
    });

    /* nei local */

    ctx.log.debug('Process x-snmp-cdpGlobal entries');
    ctx.ntableForEach1('x-snmp-cdpGlobal', 1, (did, k1, v, t) => {
        if (v.cdpGlobalDeviceIdFormat === undefined || /* cisco reports device name without format */
            v.cdpGlobalDeviceIdFormat == 3) /* 3 is other, assume it's the device name */
            addDeviceName(ctx, did, v.cdpGlobalDeviceIdDecoded, t);
        else if (v.cdpGlobalDeviceIdFormat == 2) /* macAddress */
            addDeviceMac(ctx, did, v.cdpGlobalDeviceIdDecoded, undefined, t);
        else if (v.cdpGlobalDeviceIdFormat == 2) /* serialNumber */
            addDeviceProp(ctx, did, ['serial'], v.cdpGlobalDeviceIdDecoded, t);
    });

    ctx.log.debug('Process x-snmp-lldpLocSys entries');
    ctx.ntableForEach1('x-snmp-lldpLocSys', 1, (did, k1, v, t) => {
        if (v.chassisIdSubtype == 4) /* macAddress */
            addDeviceMac(ctx, did, v.chassisIdDecoded, undefined, t);
        else if (v.chassisIdSubtype == 5) /* networkAddress */
            addDeviceIp(ctx, did, v.chassisIdDecoded, t);

        addDeviceName(ctx, did, v.sysName, t);
        addDeviceProp(ctx, did, ['description'], v.sysDesc, t);

        if (v.sysCapEnabledNames) {
            for (let c of v.sysCapEnabledNames)
                addDeviceProp(ctx, did, ['capability'], c, t);
        }
    });

    ctx.log.debug('Process x-snmp-lldpLocMan entries');
    ctx.ntableForEach1('x-snmp-lldpLocMan', 1, (did, k1, v, t) => {
        addDeviceIp(ctx, did, v.manAddr, t);
    });

    ctx.log.debug('Process x-snmp-lldpLocPort entries');
    ctx.ntableForEach2('x-snmp-lldpLocPort', 1, (did, k1, k2, v, t) => {
        /* getIfname skips undefined alias values */
        let candidateAliases = [v.portDesc, v.portIdDecoded];
        /* workaround for some HP switches otherwise we cannot attached portNum
         * because we cannot match an interface */
        let portMatch = /^Port\s+#([0-9]+)$/.exec(v.portDesc);
        if (portMatch)
            candidateAliases.push('Port ' + portMatch[1].padStart(2));
        let ifname = getIfnameWithGuess(ctx, did, candidateAliases, 'cannot attach lldpLocPort data');
        if (ifname === undefined)
            return; /* minimum required */

        if (v.portNum !== undefined)
            ctx.ualias(['iface', did, `_snmp_lldpPortNum_${v.portNum}`], ifname);
        /* usually a port short name but not necessarily */
        if (v.portIdDecoded !== undefined)
            ctx.ualias(['iface', did, v.portIdDecoded], ifname);
        /* lldp remote port name advertised on some HP switches */
        if (v.portDesc !== undefined && /^Port\s+#[0-9]+$/.test(v.portDesc))
            ctx.ualias(['iface', did, v.portDesc], ifname);
    });

    /* nei remote */

    ctx.log.debug('Process x-snmp-lldpRem entries');
    ctx.ntableForEach2('x-snmp-lldpRem', 1, (did, k1, k2, v, t) => {
        /* assume localPortNum defined, index is in the oid */
        let ifname = getIfname(ctx, did, `_snmp_lldpPortNum_${v.localPortNum}`, 'cannot attach lldpLocRem data');
        if (ifname === undefined)
            return; /* minimum required */

        processSnmpLldpNeiEntry(ctx, did, ifname, v);
    });

    ctx.log.debug('Process x-snmp-cdpCache entries');
    ctx.ntableForEach2('x-snmp-cdpCache', 1, (did, k1, k2, v, t) => {
        /* assume ifIndex defined, index is in the oid */
        let ifname = getIfname(ctx, did, `_snmp_ifIndex_${v.ifIndex}`, 'cannot attach cdpCache data');
        if (ifname === undefined)
            return; /* minimum required */

        processSnmpCdpNeiEntry(ctx, did, ifname, v);
    });

    /* conflicts resolution */

    ctx.log.debug('Try to resolve conflicts');
    tryResolve(ctx);

    /* rarp ifname resolution */
    util.owalk(ctx.db.rarp, (o, path) => {
        if (path.length == 3) {
            let ifname = getIfname(ctx, path[2], `_snmp_ifIndex_${o}`, `cannot resolve rarp ifIndex, ${JSON.stringify(path)}`);
            util.oset(ctx.db.rarp, path, ifname);
        }
        return true;
    });

    return true;
}

builder.register(200, DEFINITION);
