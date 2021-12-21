'use strict';

const builder = require('../builder.js');
const dbhelpers = require('../dbhelpers.js');
const util = require('../util.js');

const DEFINITION = {
    comment: 'build human interfaces table',
    fn: run,
};

const RE_IGNORE_IFACE_NAME = /^(unrouted VLAN [0-9]+|.+\/[0-9]+--(C|Unc)ontrolled)$/;

function buildCiscoHints(od, oif, osp) {
    var out = {
        access: { hasData: false },
        trunk: { hasData: false },
        explain: '',
    };

    if (!oif.pvlan && /* assume there vlan normalization was not possible */
        osp.ciscoVmVlanType == 3 /* multiVlan */) {
        /* Try to give a hint about vlans of a trunk interface. */
        if (osp.ciscoVmVlansDecoded) {
            let vlans = (new util.Ranges(osp.ciscoVmVlansDecoded)).toString(', ');
            out.trunk.hasData = (vlans != '');
            out.trunk.isDefault = false;
            out.explain += `\n- trunk: ${vlans} (native unknown)`;
        }
    }
    else if (oif.swPortMode != builder.SW_PORT_MODE_FEX /* not a FEX uplink */) {
        if (osp.ciscoVmVlan) {
            out.access.hasData = true;
            out.access.isDefault = (osp.ciscoVmVlan == 1);
            out.explain += `\n- access: ${osp.ciscoVmVlan}`;
        }

        if (osp.ciscoVlanTrunkPortNativeVlan && osp.ciscoVlanTrunkPortVlansEnabledDecoded) {
            out.trunk.hasData = true;
            let explain = `${osp.ciscoVlanTrunkPortNativeVlan} (native)`;
            let tagged = (new util.Ranges(osp.ciscoVlanTrunkPortVlansEnabledDecoded))
                .remove(osp.ciscoVlanTrunkPortNativeVlan)
                .toString(', ');
            if (tagged)
                explain += `, ${tagged}`;
            out.trunk.isDefault = (osp.ciscoVlanTrunkPortNativeVlan == 1 && tagged == '2-4094') ||
                (osp.ciscoVlanTrunkPortNativeVlan == 1 && !tagged /* this "or" was a workaround for ...? */);
            out.explain += `\n- trunk: ${explain}`;
        }
    }

    if (out.explain)
        out.explain = `Switchport configuration:${out.explain}`;

    return out;
}

function buildMeta(od, oif, osp) {
    var out = {};
    var messages = {
        speed: [],
        mode: [],
        pvlan:  [],
        tagged:  [],
        untagged:  [],
        description:  [],
        status:  [],
    };

    if (oif.adminStatus == builder.IF_STATUS_UP && oif.operStatus == builder.IF_STATUS_UP) {
        if (oif.speed < 100000000)
            messages.speed.push({ level: 1, text: 'Low speed reported' });

        if (oif.duplex == builder.IF_DUPLEX_STATUS_HALF)
            messages.speed.push({ level: 2, text: 'Half duplex reported' });
        else if (oif.duplex == builder.IF_DUPLEX_STATUS_UNKNOWN)
            messages.speed.push({ level: 1, text: 'Unknown duplex status' });
    }

    if (oif.adminStatus == builder.IF_STATUS_UP) {
        if (oif.swPortMode == builder.SW_PORT_MODE_AUTO || oif.swPortMode == builder.SW_PORT_MODE_DESIRABLE_TRUNK)
            messages.mode.push({ level: oif.operStatus == builder.IF_STATUS_UP ? 2 : 1, text: 'Switchport dynamic configuration' });
    }

    if (oif.adminStatus == builder.IF_STATUS_UP && !oif.description)
        messages.description.push({ level: 1, text: 'Port is enabled, description expected' });

    let cisco = buildCiscoHints(od, oif, osp);

    if (!oif.pvlan && !oif.untagged && !oif.tagged &&
        (cisco.access.hasData || cisco.trunk.hasData)) {
        /* pvlan, untagged, tagged data could not be normalized, this is most likely
         * a dynamic port. It maybe also a multiVlan interface on a Cisco FEX, */
        messages.pvlan.push({ level: 1, text: cisco.explain });
        messages.untagged.push({ level: 1, text: cisco.explain });
        messages.tagged.push({ level: 1, text: cisco.explain });
    }
    else if (cisco.access.hasData && !cisco.access.isDefault &&
             cisco.trunk.hasData && !cisco.trunk.isDefault) {
        messages.mode.push({ level: 1, text: `Mixed access/trunk configuration\n${cisco.explain}` });
    }
    else if ((oif.swPortStatus == builder.SW_PORT_STATUS_TRUNKING ||
              oif.swPortMode == builder.SW_PORT_MODE_TRUNK ||
              oif.swPortMode == builder.SW_PORT_MODE_TRUNK_NO_NEGO) &&
             cisco.access.hasData && !cisco.access.isDefault) {
        messages.mode.push({ level: 1, text: `Access configuration on a trunking port\n${cisco.explain}` });
    }
    else if (((oif.swPortStatus == builder.SW_PORT_STATUS_NOT_TRUNKING &&
               oif.adminStatus == builder.IF_STATUS_UP &&
               oif.operStatus == builder.IF_STATUS_UP) ||
              oif.swPortMode == builder.SW_PORT_MODE_ACCESS) &&
              cisco.trunk.hasData && !cisco.trunk.isDefault) {
        messages.mode.push({ level: 1, text: `Trunk configuration on a non-trunking port\n${cisco.explain}` });
    }

    /* prepare <out>, aggregate messages */
    for (let k in messages) {
        let agg = { level: 0, text: [] };
        for (let i = 0; i < messages[k].length; i++)  {
            if (messages[k][i].level > agg.level)
                agg.level = messages[k][i].level;
            agg.text.push(messages[k][i].text);
        }
        if (agg.level != 0 || agg.text.length > 0)
            out[k] = agg;
    }

    return out;
}

function nei2peer(db, n) {
    var out = {};
    out.id = n.id;
    out.label = dbhelpers.getDeviceBestName(db, n.id, true);
    out.name = dbhelpers.getDeviceName(db, n.id);
    out.ip = dbhelpers.getDeviceIp(db, n.id);
    out.type = n.normCapabilityType;
    let mac = dbhelpers.getDeviceMac(db, n.id);
    if (mac)
        out.vendor = dbhelpers.getMacsVendors(mac)[0];
    out.ifname = dbhelpers.shortIfname(n.ifname);
    return out;
}

function fdb2peer(db, n) {
    var out = {};
    if (n.id) {
        out.id = n.id;
        out.label = dbhelpers.getDeviceBestName(db, n.id, true);
        out.name = dbhelpers.getDeviceName(db, n.id);
        let ip = dbhelpers.getDeviceIpsFromMac(db, n.id, n.mac);
        if (ip.length == 0) {
            ip = dbhelpers.getDeviceIp(db, n.id);
            if (ip)
                ip = [ ip ];
        }
        if (ip && ip.length > 0) {
            ip.sort(util.cmpIntSplit);
            out.ip = ip.join(', ');
        }
        let capability = util.oget(db.sdevice, [n.id, 'capability']);
        let normed = dbhelpers.normCapability(capability);
        out.type = dbhelpers.normCapabilityType(normed);
    }
    if (!out.label)
        out.label = n.mac;
    out.mac = n.mac;
    out.vendor = dbhelpers.getMacsVendors(n.mac)[0];
    if (n.vlan)
        out.vlan = n.vlan.join(', ');
    return out;
}

function run(ctx, def) {
    ctx.db.hiface = {};

    for (let did in ctx.db.sdevice) {
        let od = ctx.db.sdevice[did];
        let ifrows = []
        let ifname2row = {};
        let poIfname2member = {};

        for (let kif in od.iface) {
            let oif = od.iface[kif];
            let osp = util.oget(ctx.db.sswport, [ did, kif ]) || {};
            let ifrow = { did };
            let ifname = util.first(oif.name);

            /* skip some interfaces by name */
            if (RE_IGNORE_IFACE_NAME.test(ifname))
                continue;

            ifrow.dname = util.ifNot(util.first(od.name), null);

            ifrow.hwAddr = util.ifNot(oif.mac, null);
            ifrow.name = util.ifNot(ifname, null);
            ifrow.description = util.ifNot(oif.description, null);

            let hadmst = builder.IF_STATUS[oif.adminStatus];
            let hoperst = builder.IF_STATUS[oif.operStatus];
            ifrow.status = hadmst && hoperst ? `${hadmst} / ${hoperst}` :
                (hadmst ? hadmst : null);

            let hduplex = builder.IF_DUPLEX_STATUS[oif.duplex];
            ifrow.speed = oif.speed ?
                (util.humanNumber(oif.speed, { precision: 0 }) +
                 (hduplex ? ` / ${hduplex}` : '')) : null;

            let group = oif.member || oif.memberOf;
            if (group)
                group = Array.isArray(group)
                    ? group.map(dbhelpers.shortIfname).join(', ')
                    : dbhelpers.shortIfname(group);
            ifrow.group = util.ifNot(group, null);

            let mode = builder.SW_PORT_MODE[oif.swPortMode];
            if (mode && builder.SW_PORT_STATUS[oif.swPortStatus] &&
                (oif.swPortMode == builder.SW_PORT_MODE_DESIRABLE_TRUNK ||
                 oif.swPortMode == builder.SW_PORT_MODE_AUTO) &&
                oif.adminStatus == builder.IF_STATUS_UP &&
                oif.operStatus == builder.IF_STATUS_UP)
                mode += ` / ${builder.SW_PORT_STATUS[oif.swPortStatus]}`;
            ifrow.mode = util.ifNot(mode, null);

            ifrow.pvlan = util.ifNot(oif.pvlan, null);
            ifrow.untagged = oif.untagged ? (new util.Ranges(oif.untagged)).toString(', ') : null;
            ifrow.tagged = oif.tagged ? (new util.Ranges(oif.tagged)).toString(', ') : null;

            let peers;
            if (oif.member) {
                poIfname2member[kif] = oif.member;
            }
            else {
                let nei = dbhelpers.getNei(ctx.db, did, kif, ['switch']);
                if (nei.length > 0) {
                    peers = nei.map((n) => nei2peer(ctx.db, n));
                }
                else {
                    let fdb = dbhelpers.getFdb(ctx.db, did, kif);
                    peers = fdb.map((n) => fdb2peer(ctx.db, n));
                }
            }

            ifrow.peers = util.ifNot(peers, null);
            ifrow._meta = buildMeta(od, oif, osp);

            /* done for this interface */
            ifname2row[kif] = ifrows.length;
            ifrows.push(ifrow);
        }

        /* second pass on the interfaces to copy peers on port-channels */
        for (let poIfname in poIfname2member) {
            for (let m of poIfname2member[poIfname]) {
                if (ifname2row[poIfname] && ifname2row[m] && ifrows[ifname2row[m]] && ifrows[ifname2row[m]].peers) {
                    ifrows[ifname2row[poIfname]].peers = ifrows[ifname2row[m]].peers;
                    break;
                }
            }
        }

        ctx.db.hiface[did] = ifrows;
    }
    return true;
}

builder.register(810, DEFINITION);
