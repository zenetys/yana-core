'use strict';

const config = require('./config.js');
const fs = require('fs');
const Logger = require('./logger.js');
const util = require('./util.js');
const log = new Logger('parser');

/* parsers registration */

const PARSERS = {};

function register(section, definition) {
    PARSERS[section] = definition;
}

/* Load parsers, which fills <PARSERS> because handlers register
 * themselves by calling register(). */
function reload() {
    var files = [];

    for (let dir of config.options.parserDirs) {
        try {
            files.push(... util.lsDirSync(dir, {
                lstat: true,
                apply: (out, d,n,s) => {
                    if (s.isFile() && n.substr(-3) == '.js')
                        out.push(d + '/' + n);
                }
            }));
        }
        catch (e) {
            log.error(e);
            log.error('Failed to list parsers in ' + dir);
            return false;
        }
    }

    /* assume exceptions are handled by caller */
    for (let i of files) {
        log.debug('Load ' + i);
        delete require.cache[require.resolve(i)]; /* for reload */
        require(i);
    }
}

/* parser core */

function onNscanSectionHeader(ctx) {
    var result;

    /* handle section close callback */
    onNscanSectionClose(ctx);

    /* Reset section data parser. */
    ctx.parser = undefined;

    /* Split section header into an array of arguments. The first argument
    /* is mandatory, it represents the type of the section. The section type
     * allows to find a data parser for the content of the section. */
    ctx.section = ctx.raw.substr(5, ctx.raw.length - 10).trim().split(/\s+/);

    if (ctx.section.length < 1) {
        ctx.log.error('Invalid section header');
        ctx.errors++;
        return;
    }

    /* There must be a parser registered for this type of section. A falsy
     * value is accepted and allows to ignore the entire section data. This
     * case is treated in the onNscanSectionData() function. */
    ctx.parser = ctx.parsers[ctx.section[0]];
    if (ctx.parser === undefined) {
        ctx.log.error(`No parser for section type ${ctx.section[0]}`);
        ctx.errors++;
        return;
    }

    /* A callback may be called when entering a section, its return value
     * is handled as follows:
     * - null: section ignored by parser, skip data,
     * - falsy or exception: error, skip data,
     * - otherwise: proceed with parsing the data. */
    if (ctx.parser.onSectionHeader) {
        try { result = ctx.parser.onSectionHeader(ctx); }
        catch (e) { result = e; }

        if (result === null) {
            ctx.log.debug2('Ignored by parser:', ctx.raw);
            ctx.parser = null;
            return;
        }
        if (!result)
            result = Error('callback returned a falsy value');
        if (result instanceof Error) {
            ctx.log.error(`Parser failed on section ${ctx.section[0]},`,
                `header callback.`, result);
            ctx.errors++;
            ctx.parser = undefined;
            return;
        }
    }
}

function onNscanSectionData(ctx) {
    var result;

    /* Line skipped due to previous error during section header parsing. */
    if (ctx.parser === undefined) {
        ctx.skipped++;
        return;
    }

    /* Line ignored due to falsy section header parser or because there
     * is no section data parser. */
    if (!ctx.parser || !ctx.parser.onSectionData) {
        ctx.ignored++;
        return;
    }

    /* Execute the section data parser for the current line. The return
     * value is handled as follows:
     * - null: line ignored by parser,
     * - falsy or exception: error,
     * - otherwise: acquired ok */
    try { result = ctx.parser.onSectionData(ctx); }
    catch (e) { result = e; }
    if (result === null) {
        ctx.log.debug2('Ignored by parser:', ctx.raw);
        ctx.ignored++;
        return;
    }
    if (!result)
        result = Error('callback returned a falsy value');
    if (result instanceof Error) {
        ctx.log.error(`Parser failed on section ${ctx.section[0]},`,
            `line ${JSON.stringify(ctx.raw)}.`, result);
        ctx.errors++;
        return;
    }
    ctx.acquired++;
}

function onNscanLine(ctx, data) {
    ctx.line++;
    ctx.raw = data;

    ctx.log.debug3('Input:', ctx.raw);

    /* Lines begining with a dash are treated as comments and are ignored.
     * Empty lines or lines containing only whitespaces are skipped. */
    if (ctx.raw[0] == '#' || ctx.raw.length == 0 || ctx.raw.trim().length == 0)
        return;

    if (ctx.raw.substr(0, 5) == '<<<< ' && ctx.raw.substr(-5) == ' >>>>')
        onNscanSectionHeader(ctx);
    else
        onNscanSectionData(ctx);
}

function onNscanSectionClose(ctx) {
    var result;

    if (ctx.parser === undefined || !ctx.parser.onSectionClose)
        return;

    try { result = ctx.parser.onSectionClose(ctx); }
    catch (e) { result = e; }

    if (!result && result !== null)
        result = Error('callback returned a falsy value');
    if (result instanceof Error) {
        ctx.log.error(`Parser failed on section ${ctx.section[0]},`,
            `close callback.`, result);
        ctx.errors++;
    }
}

function onNscanClose(ctx) {
    /* handle section close callback */
    onNscanSectionClose(ctx);
    ctx.ms = (new Date()) - ctx.ms;

    let fn = ctx.errors ? 'error' : 'info';
    ctx.log[fn](`EOF, acquired=${ctx.acquired}, errors=${ctx.errors}, \
skipped=${ctx.skipped}, ignored=${ctx.ignored}, time=${ctx.ms}ms`);
}

/**
 * Parse an nscan file.
 *
 * @param file Path to the nscan file to parse.
 * @param parsers Object holding section parsers.
 * @param lid String to use as identifier for the file in log messages. This
 *      argument is optional and defaults to the basename of the file.
 *
 * @return The context object filled during the parsing.
 */
function nscanParser(lid) {
    var ctx = {
        parsers: PARSERS, /* reference to the object holding section parsers */
        line: 0, /* current line number in the file */
        acquired: 0, /* data lines acquired */
        errors: 0, /* any error when parsing a line, data or section header */
        skipped: 0, /* due to errors, eg: bad section header */
        ignored: 0, /* due to disabled sections or parser null result */
        raw: undefined, /* current line to be parsed */
        section: undefined, /* current section arguments */
        parser: undefined, /* current section data parser */
        autoinc: {}, /* container for auto-increments */
        db: {}, /* container where parsed data get stored to */
        ms: new Date(), /* assume start, updated to elapsed time on close */
    };

    ctx.lid = lid
    ctx.log = log.dup({
        prefix: () => {
            let out = ctx.lid;
            if (ctx.line)
                out += ':' + ctx.line;
            return out;
        }
    });
    return ctx;
}

/* sections parsers */

/* Used by parseRegex() to evaluate index and data rules.
 * Optional callbacks: filter() is ran before apply() */
function buildValue(def, ctx, cap, errHint) {
    var outK, outV;

    if (def.value)
        outV = def.value;
    else if (def.fn)
        outV = def.fn(ctx, cap)
    else if (def.group) {
        if (!cap.groups[def.group])
            throw Error(`${errHint}: capture group not found`);
        if (def.match) {
            for (let m in def.match) {
                if (cap.groups[def.group] != m)
                    continue;
                let matchDef = def.match[m];
                if (def.match[m].key) {
                    outK = def.match[m].key;
                    matchDef = Object.assign({}, matchDef);
                    delete matchDef['key'];
                }
                outV = buildValue(matchDef, ctx, cap, `${errHint}, match ${m}`);
                if (outV === false) /* assume it is due to filter */
                    return outV; /* ignore filtered out */
            }
        }
        else
            outV = cap.groups[def.group];
    }
    else if (def.autoinc) {
        let base = def.autoinc.base.map((e, i) => buildValue(
            e, ctx, cap, `${errHint}, autoinc base #${i}`)).join('/');
        let uniq = def.autoinc.uniq.map((e, i) => buildValue(
            e, ctx, cap, `${errHint}, autoinc uniq #${i}`)).join('/');
        if (!ctx.autoinc[base])
            ctx.autoinc[base] = { next: 0, uniq2inc: {} };
        if (ctx.autoinc[base].uniq2inc[uniq] === undefined) {
            outV = ctx.autoinc[base].next++;
            ctx.autoinc[base].uniq2inc[uniq] = outV;
        }
        else
            outV = ctx.autoinc[base].uniq2inc[uniq];
    }
    else
        throw Error(`${errHint}: unsupported definition`);

    if (def.filter && !def.filter(outV, ctx, cap))
        return false; /* ignore filtered out */
    if (def.apply)
        outV = def.apply(outV)

    /* match mode may have already set a key */
    if (def.key && outV !== undefined && outK === undefined)
        outK = def.key;

    return outK === undefined
        ? (outV === undefined ? null /* ignore */ : outV)
        : { [outK]: outV };
}

/* Optional callbacks: filter() is ran before fn() */
function parseRegex(ctx) {
    var hasMatch = false;

    for (let r = 0; r < this.rules.length; r++) {
        let rule = this.rules[r];
        let o = {}, p = o;
        let c = rule.regex.exec(ctx.raw);
        if (c == null)
            continue;
        hasMatch = true;

        if (rule.filter && !rule.filter(ctx, c))
            return null;

        if (rule.fn) {
            let result = rule.fn(ctx, c);
            if (!result)
                return result;
            if (util.isObject(result))
                util.omerge(o, result);
        }

        /* build index */
        if (rule.index) {
            for (let i = 0; i < rule.index.length; i++) {
                let k = buildValue(rule.index[i], ctx, c, `rule #${r}, index #${i}`);
                if (k === undefined || k === false || k === null)
                    return null; /* ignore line */
                if (typeof k != 'number' && (typeof k != 'string' || k.length == 0))
                    throw Error(`rule #${r}, index #${i}: did not return a suitable key`);
                p[k] = {};
                p = p[k]; /* advance o pointer */
            }
        }

        /* build kv data */
        if (rule.data) {
            for (let i = 0; i < rule.data.length; i++) {
                let kv = buildValue(rule.data[i], ctx, c, `rule #${r}, data #${i}`);
                if (kv === false) /* eg: x-snmp-if, do not add { ifSpeed: 0 } */
                    continue; /* skip this KV pair */
                if (kv === null) /* not an error */
                    return null; /* ignore line */
                if (!util.isObject(kv)) /* require an object to merge */
                    throw Error(`rule #${r}, data #${i}: did not return an object`);
                util.omerge(p, kv);
            }
        }

        util.omerge(ctx.db, o);
        break;
    }

    if (!hasMatch)
        throw Error('none of the rules matched');
    return true;
}

/* decoders */

const CDP_CAP_NAME = {
    0x001: 'router', /* R */
    0x002: 'tb-bridge', /* T, transparent bridge */
    0x004: 'sr-bridge', /* B, source-route bridge */
    0x008: 'switch', /* S */
    0x010: 'host', /* H */
    0x020: 'igmp-conditional-filtering', /* I, IGMP */
    0x040: 'repeater', /* r */
    0x080: 'voip-phone', /* P */
    0x100: 'remotely-managed-device', /* M */
    0x200: 'cast-phone-port', /* C */
    0x400: 'two-port-mac-relay', /* W */
}

/* CDP / Cisco capabilities reported:
 * - AP: tb-bridge, igmp-conditional-filtering
 * - phone: host, voip-phone, two-port-mac-relay
 * - switch l2: switch, igmp-conditional-filtering
 * - switch l2/l3: router, switch, igmp-conditional-filtering
 * - router: router, sr-bridge, switch
 */

const LLDP_CAP_NAME = {
    0x01: 'other', /* O */
    0x02: 'repeater', /* P */
    0x04: 'bridge', /* B */
    0x08: 'wlanAccessPoint', /* W */
    0x10: 'router', /* R */
    0x20: 'telephone', /* T */
    0x40: 'docsisCableDevice', /* C */
    0x80: 'stationOnly', /* S */
}

function decCdpAddress(raw, type) {
    if (type == 1) /* ip */
        return decHexStringIp(raw);
    /* decnet(2), pup(3), chaos(4), xns(5), x121(6), appletalk(7), clns(8),
     * lat(9), vines(10), cons(11), apollo(12), stun(13), novell(14), qllc(15),
     * snapshot(16), atmIlmi(17), bstun(18), x25pvc(19), ipv6(20), cdm(21),
     * nbf(22), bpxIgx(23), clnsPfx(24), http(25), unknown(65535) or default */
    return undefined;
}

function decCdpCap(integer) {
    var capNames = [];
    for (let i in CDP_CAP_NAME) {
        if (integer & i)
            capNames.push(CDP_CAP_NAME[i]);
    }
    return capNames;
}

function decCdpDeviceId(raw, type) {
    if (type == 2) /* macAddress */
        return decHexString(raw).replace(/(..)/g, ':$1').substr(1);
    /* serialNumber(1), other(3), or default */
    return decHexString(raw);
}

/**
 * Decode Cisco vlanTrunkPortVlansEnabled|vmVlans(2k,3k,4k) hex strings.
 *
 * @param o Object containing vlans(2k,3k,4k) properties
 * @param baseName Base name of vlans* properties in the object <o>.
 *     For instance, when <baseName> is "vlanTrunkPortVlansEnabled", the
 *     following properties in <o> will be read to build the list of vlans:
 *         - vlanTrunkPortVlansEnabled
 *         - vlanTrunkPortVlansEnabled2k
 *         - vlanTrunkPortVlansEnabled3k
 *         - vlanTrunkPortVlansEnabled4k
 * @param typeOffset Force a vlan id offset for the most significant byte.
 *     In practive this is used because vmVlans counts vlan ids from 1,
 *     whereas vlanTrunkPortVlansEnabled counts vlan ids from 0. Thus, the
 *     <typeOffset> value for <vmVlans> data should be 1. If this parameter
 *     is not given, it is set to 1 if <baseName> is "vmVlans", otherwise
 *     it is set to 0.
 * @throws Error if the vlans* properties contain invalid data.
 * @return An array of from/to objects corresponding to the contiguous
 *     ranges of enabled vlans.
 */
function decCiscoVlansEnabled(o, baseName, typeOffset) {
    var full = '';
    var noMore = false;
    var err = null;
    var out = new util.Ranges();

    for (let k of ['', '2k', '3k', '4k']) {
        k = baseName + k;
        if (o[k]) {
            if (noMore)
                err = k;
            full += o[k].replace(/ /g, '');
        }
        else
            noMore = true;
    }

    if (err)
        throw Error(`invalid vlansEnabled data, gap before ${err}`)
    if (full.length == 0 || full.length % 256 != 0)
        throw Error('invalid vlansEnabled data, expecting 128 bytes sequences');

    if (typeOffset === undefined) {
        /* vmVlans counts vlan ids from 1
         * vlanTrunkPortVlansEnabled counts vlan ids from 0 */
        typeOffset = (baseName == 'vmVlans') ? 1 : 0;
    }

    for (let i = 0, offset = 0; i < full.length; i += 2, offset += 8) {
        // |  |  |  |  |  |  |  |    ... loop ...
        // 0  1  2  3  4  5  6  7  [+ typeOffset] + offset = vlan
        let b8 = decHexNum(full.substr(i, 2));
        // b1(7) = 128  # vlan = offset + 0
        // b1(6) = 64   # vlan = offset + 1
        // b1(5) = 32   # vlan = offset + 2
        // b1(4) = 16   # vlan = offset + 3
        // b1(3) = 8    # vlan = offset + 4
        // b1(2) = 4    # vlan = offset + 5
        // b1(1) = 2    # vlan = offset + 6
        // b1(0) = 1    # vlan = offset + 7
        /* The b8 > 0 condition is just an optim. If b8 == 0, all bits are 0,
         * nothing needs to be checked since no vlan is enabled. */
        for (let ib1 = 7; b8 > 0 && ib1 >= 0; ib1--) {
            let b1 = Math.pow(2, ib1);
            if ((b8 & b1) > 0)
                out.add(offset + (7 - ib1 + typeOffset));
        }
    }
    return out.get();
}

function decHexDate(raw) {
    if (raw.length < 24)
        throw Error('invalid hex date string')

    var d = '';
    d += decHexNum(raw.substr(0, 5)).toString().padStart(4, '0');
    d += '-' + decHexNum(raw.substr(6, 2)).toString().padStart(2, '0');
    d += '-' + decHexNum(raw.substr(9, 2)).toString().padStart(2, '0');
    d += 'T' + decHexNum(raw.substr(12, 2)).toString().padStart(2, '0');
    d += ':' + decHexNum(raw.substr(15, 2)).toString().padStart(2, '0');
    d += ':' + decHexNum(raw.substr(18, 2)).toString().padStart(2, '0');
    d += '.' + decHexNum(raw.substr(21, 2)).toString().substr(0, 1);
    if (raw.length >= 33) {
        d += Buffer.from([decHexNum(raw.substr(24, 2))]).toString();
        d += decHexNum(raw.substr(27, 2)).toString().padStart(2, '0');
        d += ':' + decHexNum(raw.substr(30, 2)).toString().padStart(2, '0');
    }
    else
        d+= 'Z';

    d = new Date(d);
    if (isNaN(d.getTime()))
        throw Error(`invalid hex date string ${raw}`);
    return d.getTime() / 1000;
}

function decHexNum(hex) {
    var dec = parseInt(hex.replace(/ /g, ''), 16);
    if (isNaN(dec))
        throw Error(`invalid hex byte ${hex}`);
    return dec;
}

/**
 * Convert an SNMP hex-string to string.
 *
 * @param input SNMP hex-string, ex: "73 75 70 70 6F 72 74 ".
 * @param encoding Optional encoding for Buffer.toString(). Default is utf-8.
 * @throws Error if parseInt() fails to parse any hex number.
 * @return Decoded value as string.
 */
function decHexString(input, encoding) {
    var codes = [], buffer;
    for (let i = 0; i < input.length; i += 3)
        codes.push(decHexNum(input.substr(i, 2)));
    buffer = Buffer.from(codes);
    /* some device add a null byte at the end of the string
     * this is not an ideal resolution... */
    if (buffer.slice(-1) == String.fromCharCode(0x0))
        buffer = buffer.slice(0, -1);
    return buffer.toString(encoding);
}

function decHexStringBits(input) {
    var shiftBits = 0;
    var output = 0;

    for (let i = 0; i < input.length; i += 3) {
        let dec = decHexNum(input.substr(i, 2));
        let reversed = 0;
        if (dec & 0x01) reversed += 0x80;
        if (dec & 0x02) reversed += 0x40;
        if (dec & 0x04) reversed += 0x20;
        if (dec & 0x08) reversed += 0x10;
        if (dec & 0x10) reversed += 0x08;
        if (dec & 0x20) reversed += 0x04;
        if (dec & 0x40) reversed += 0x02;
        if (dec & 0x80) reversed += 0x01;
        output += (reversed << shiftBits);
        shiftBits += 8;
    }

    return output;
}

/**
 * Convert an SNMP hex-string to an IPv4 address.
 *
 * @param input IPv4 address in SNMP hex-string format.
 * @throws Error if parseInt() fails to parse any hex byte
 * @return IPv4 address as string.
 */
function decHexStringIp(input) {
    var ip = '';
    for (let i = 0; i < input.length; i += 3) {
        if (ip.length > 0)
            ip += '.';
        ip += decHexNum(input.substr(i, 2));
    }
    return ip;
}

/**
 * Convert an SNMP hex-string to a MAC address.
 *
 * @param input MAC address in SNMP hex-string format.
 * @return MAC address converted to a colon-separated lowercase hex string.
 */
function decHexStringMac(input) {
    return input.trim().toLowerCase().replace(/ /g, ':')
}

function decLldpCap(integer) {
    var capNames = [];
    for (let i in LLDP_CAP_NAME) {
        if (integer & i)
            capNames.push(LLDP_CAP_NAME[i]);
    }
    return capNames;
}

const RE_LLDP_MAC_ALT_REPRESENTATION = /^([0-9a-f]{2} ){2}((3a|2d) ([0-9a-f]{2} ){2}){5}/;

function decLldpChassisId(raw, type) {
    if (type == 1) /* chassisComponent */
        return decHexString(raw);
    else if (type == 2) /* interfaceAlias */
        return decHexString(raw);
    else if (type == 3) /* portComponent */
        return decHexString(raw);
    else if (type == 4) { /* macAddress */
        let rawLc = raw.toLowerCase();
        let alt = RE_LLDP_MAC_ALT_REPRESENTATION.exec(rawLc);
        if (alt) {
            return (alt[3] == '2d')
                ? decHexString(raw).toLowerCase().replaceAll('-', ':')
                : decHexString(raw).toLowerCase();
        }
        else
            return decHexStringMac(raw);
    }
    else if (type == 5) { /* networkAddress */
        if (raw.substr(0, 3) == '01 ') /* ipv4 */
            return decHexStringIp(raw.substr(3));
        /* ipv6, ... */
    }
    else if (type == 6) /* interfaceName */
        return decHexString(raw);
    else if (type == 7) /* local */
        return decHexString(raw);
    /* default */
    return undefined;
}

function decLldpPortId(raw, type) {
    if (type == 1) /* interfaceAlias */
        return decHexString(raw);
    else if (type == 2) /* portComponent */
        return decHexString(raw);
    else if (type == 3) { /* macAddress */
        let rawLc = raw.toLowerCase();
        let alt = RE_LLDP_MAC_ALT_REPRESENTATION.exec(rawLc);
        if (alt) {
            return (alt[3] == '2d')
                ? decHexString(raw).toLowerCase().replaceAll('-', ':')
                : decHexString(raw).toLowerCase();
        }
        else
            return decHexStringMac(raw);
    }
    else if (type == 4) { /* networkAddress */
        if (raw.substr(0, 3) == '01 ') /* ipv4 */
            return decHexStringIp(raw.substr(3));
        /* ipv6, ... */
    }
    else if (type == 5) /* interfaceName */
        return decHexString(raw);
    else if (type == 6) /* agentCircuitId */
        return decHexString(raw);
    else if (type == 7) /* local */
        return decHexString(raw);
    /* default */
    return undefined;
}

function decNum(input) {
    var num = parseInt(input, 10);
    if (isNaN(num))
        throw Error(`invalid number ${input}`);
    return num;
}

/**
 * Convert a mac address from decimal OID notation to an hex notation.
 *
 * @param oid Mac address in OID notation, eg: "40.199.206.23.139.175".
 * @throws Error if parseInt() fails to parse any number from the OID.
 * @returns Mac address converted to a colon-separated lowercase hex string,
 *      eg: "28:c7:ce:17:8b:af".
 */
function decOidMac(oid) {
    var decimals = oid.split('.');
    var mac = '';
    for (let dec of decimals) {
        if (mac.length > 0)
            mac += ':';
        let num = decNum(dec);
        mac += num.toString(16).padStart(2, '0');
    }
    return mac;
}

function decQBridgePorts(portsHexString) {
    var portList = [];

    for (let i = 0, portOffset = 0;
         i < portsHexString.length;
         i += 3, portOffset += 8) {

        let b8 = decHexNum(portsHexString.substr(i, 2));

        for (let bit = 7; bit >= 0; bit--) {
            let port = Math.pow(2, bit);
            if ((b8 & port) > 0)
                portList.push(portOffset + 7 - bit + 1);
        }
    }

    return portList;
}

/* exports */

module.exports = {
    register,
    reload,

    nscanParser,
    onNscanClose,
    onNscanLine,

    parseRegex,

    CDP_CAP_NAME,
    LLDP_CAP_NAME,
    decCdpAddress,
    decCdpCap,
    decCdpDeviceId,
    decCiscoVlansEnabled,
    decHexDate,
    decHexNum,
    decHexString,
    decHexStringBits,
    decHexStringIp,
    decHexStringMac,
    decLldpCap,
    decLldpChassisId,
    decLldpPortId,
    decNum,
    decOidMac,
    decQBridgePorts,
};
