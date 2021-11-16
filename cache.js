'use strict';

const builder = require('./builder.js');
const config = require('./config.js');
const crypto = require('crypto');
const events = require('events');
const fs = require('fs');
const Logger = require('./logger.js');
const parser = require('./parser.js');
const readline = require('readline');
const util = require('./util.js');
const log = new Logger('cache');
const zlib = require('zlib');

const CACHE = {};
const WATCHES = {};

const DB_SOURCES = {
    'nscan': async (f, ...rest) => await getDbFromNscanFile(f, false, ...rest),
    'nscan.gz': async (f, ...rest) => await getDbFromNscanFile(f, true, ...rest),
};

/* core */

/**
 * flush()
 * Flush all cached data.
 */
function flush() {
    Object.keys(CACHE).forEach(k => delete CACHE[k]);
    Object.keys(WATCHES).forEach(k => { WATCHES[k].close(); delete WATCHES[k]; });
}

/**
 * reload()
 * Call flush() and reinit cache.
 */
function reload() {
    log.debug('Cache reload');
    flush();
    initLsDirWatches();
    logStats();
}

/**
 * logStats()
 * Log current memory usage.
 */
function logStats() {
    var dbsInCache = Object.keys(CACHE.db || {}).reduce((r, c) =>
        r + Object.keys(CACHE.db[c]).length, 0);
    var mem = process.memoryUsage();
    var memstr = '';
    for (let i in mem) {
        if (memstr)
            memstr += ', ';
        memstr += i + '=' + util.humanNumber(mem[i],
            { base: 1024, uom: 'B', precision: 0 });
    }
    log.info(`stats: Databases: inCache=${dbsInCache}, Memory: ${memstr}`);
}

/* entity and database listing */

/**
 * getEntityList()
 * Get the list of entities.
 * @return The list of entities as an array of strings.
 *     An Error object is returned on failure.
 */
function getEntityList() {
    if (!CACHE.lsentity) {
        try {
            CACHE.lsentity = util.lsDirSync(
                config.options.dataDir,
                { stat: true, filter: (d,n,s) =>
                    s.isDirectory() && n.substr(0, 1) != '.' }
            );
        }
        catch (e) {
            log.error('Failed to list entities.', e);
            return e;
        }
        CACHE.lsentity.sort();
    }
    return CACHE.lsentity;
}

/**
 * getDbList(entity)
 * Get the list of databases available for a given <entity>.
 * @return The list of available databases for the entity, as array of objects,
 *     each object having the following two properties:
 *         - id: identifier for the database
 *         - ts: timestamp of the database in epoch seconds
 *     An Error object is returned on failure.
 */
function getDbList(entity) {
    function lsDirApplyCb(out, dir, name, stat) {
        if (!stat.isFile())
            return;

        for (let ext of Object.keys(DB_SOURCES))  {
            if (name.substr((ext.length + 1) * -1) != '.' + ext)
                continue;

            /* Return an object per database with two properties: id and timestamp.
             * The timestamp is taken from the filename when possible, otherwise
             * the mtime is used. */
            var db = { id: name.substr(0, name.length - ext.length - 1) };
            db.ts = (new Date(db.id)).getTime();
            if (isNaN(db.ts))
                db.ts = (new Date(stat.mtimeMs)).getTime();
            db.ts /= 1000; /* epoch seconds */
            out.push(db);
        }
    }

    var ls = util.oget(CACHE, ['lsdb', entity]);
    if (!ls) {
        try {
            ls = util.lsDirSync(
                `${config.options.dataDir}/${entity}`,
                { lstat: true, apply: lsDirApplyCb });
            ls.sort(util.makeCmpKey('ts', 1));
        }
        catch (e) {
            log.error(`Failed to list databases for entity ${entity}.`, e);
            return e;
        }
        util.oset(CACHE, ['lsdb', entity], ls);
    }
    return CACHE.lsdb[entity];
}

/**
 * getLatestDbId(entity)
 * Get the latest availble database ID for a given <entity>.
 * @return The latest database ID available for the given <entity>.
 *     If no database is available for the entity, undefined is returned.
 *     An Error object is returned on failure.
 */
function getLatestDbId(entity) {
    var lsdb = getDbList(entity);
    if (!(lsdb instanceof Error)) {
        lsdb = lsdb.slice(-1)[0];
        if (lsdb !== undefined)
            lsdb = lsdb.id;
    }
    return lsdb;
}

/**
 * Data watches.
 *
 * Their goal is to watch for filesystem events (inotify) on the data directory
 * <config.options.dataDir> and its children entity directories. Due to
 * the limitations on the fs.watch() API, the watches are only used to trigger
 * flushes in order to invalidate some cached data.
 *
 * The cached data involved by these flushes is:
 * - the list of entities, cached in CACHE.lsentity;
 * - the list of databases available for an entity, cached in
 *   CACHE.lsdb[<entityName>];
 *
 * The data watches ARE NOT involved in the cache of databases.
 */

/**
 * initLsDirWatches()
 * Initialize the data directory watches allowing to invalidate the cached
 * list of entities and list of available databases per entity.
 */
function initLsDirWatches() {
    const sEntity = Symbol('entityName');
    const wOpts = { persistent: false };
    var entities = getEntityList();

    log.debug('Init data watches');

    if (entities instanceof Error) {
        log.error('List entities error, cannot init data watches');
        return;
    }

    /* watch data directory */
    addDirWatch('.', `${config.options.dataDir}/`,
        (ev, fname) => onDataDirChange(ev, fname),
        'data directory');
    /* watch entity directories */
    for (let entity of entities)
        addDirWatch('.', `${config.options.dataDir}/${entity}/`,
            (ev, fname) => onEntityDirChange(ev, fname, entity),
            `entity ${entity}`);

    /* add watch helper */
    function addDirWatch(regKey, dir, cb, errHint) {
        try { WATCHES[regKey] = fs.watch(dir, wOpts, cb); }
        catch (e) { log.error(`Failed to add watch for ${errHint}`, e); }
    }

    /* flusher */
    function flushLsDirCache(entity) {
        util.orm(CACHE, ['lsentity']); /* entity list */
        util.orm(CACHE, ['lsdb', entity]); /* entity database list */
    }

    /* listeners */
    function onEntityDirChange(ev, fname, entity) {
        if (ev == 'rename' &&
            Object.keys(DB_SOURCES).some((x) => fname.endsWith('.' + x))) {
            log.debug2(`Data watch event: entity ${entity}, child ${fname}`);
            flushLsDirCache(entity);
        }
    }
    function onDataDirChange(ev, fname) {
        if (ev != 'rename')
            return; /* ignore change event */

        let stat;
        try { stat = fs.statSync(`${config.options.dataDir}/${fname}`); }
        catch (e) { stat = e; }

        if (fname == '' /* not a child */) {
            /* Something bad happened with the data directory itself, like
             * remove or rename. This is an error, so flush and clear all
             * watches. HUP or program restart is required. */
            let msg = 'Unexpected watch event: data directory itself, flush!';
            if (stat instanceof Error)
                msg += ` ${stat}`;
            log.error(msg);
            flush();
            return;
        }
        /* <fname> is the name of a child in <config.options.dataDir>. It may
         * be a new entity directory, one could have been removed or even
         * something related to a file that was / has been put in the directory,
         * We just know it involves the child entry <fname>. To make it
         * easier, remove and reinstall watch on entity directory if still
         * present. */
        log.debug2(`Data watch event: data directory, child ${fname}`);
        if (WATCHES[fname]) {
            WATCHES[fname].close();
            delete WATCHES[fname];
        }
        flushLsDirCache(fname); /* noop if it does not match an entity */
        if (!(stat instanceof Error) && stat.isDirectory())
            addDirWatch('.', `${config.options.dataDir}/${fname}/`,
                (ev, f) => onEntityDirChange(ev, f, fname),
                `entity ${fname}`);
    }
}

/* database */

/**
 * async getDb(entity, dbId)
 * Get the database ID <dbId> from entity <entity>. The database is
 * retrieved from cache if present, otherwise from a file located in the
 * entity directory. If the database is retrived from file, it gets cached
 * for subsequent access.
 * @return The database object on success.
 *     null if no source could be found for the given <entity> and <dbId>.
 *     false on error.
 */
async function getDb(entity, dbId) {
    var db = util.oget(CACHE, ['db', entity, dbId]);

    if (db) {
        log.info(`${entity}/${dbId}: Use database from cache`);
    }
    else {
        log.prefix = `${entity}/${dbId}`;
        log.info('Database not in cache, need to load from file');
        let buildOpts = {
            genid: (path) => getGenId(entity, path),
            lid: log.prefix,
        };
        db = await getDbFromFile(entity, dbId, buildOpts);
        log.prefix = undefined; /* reset */
        if (db) {
            util.oset(CACHE, ['db', entity, dbId], db);
            saveGenIdDb(entity);
            logStats();
        }
    }

    return db;
}

/**
 * async getDbFromFile(entity, dbId, buildOpts)
 * Get the database ID <dbId> from entity <entity>. The database is
 * retrieved from a file located in the entity directory. The optional
 * <buildOpts> object gets passed as second argument to builder.runBuilders(),
 * which is called if the database needs to be built.
 * @return The database object on success.
 *     null if no source could be found for database ID <dbId>.
 *     false on error.
 */
async function getDbFromFile(entity, dbId, /* optional */ buildOpts) {
    var base = `${config.options.dataDir}/${entity}/${dbId}`;
    var err, st;

    for (let ext in DB_SOURCES) {
        let file = `${base}.${ext}`;
        try {
            fs.statSync(file);
            return await DB_SOURCES[ext](file, buildOpts);
        }
        catch (e) {}
    }

    log.error('Could not find a database source');
    return null;
}

/**
 * async getDbFromNscanFile(file, isGzip, buildOpts)
 * Build a database from the given nscan <file>. If the nscan <file> is gzip'ed,
 * parameter <isGzip> must be set to true. The optional <buildOpts> object gets
 * passed as second argument to builder.runBuilders(), which is called after
 * nscan parsing to build the database.
 * @return The database object on success.
 *     false on error.
 */
async function getDbFromNscanFile(file, isGzip, /* optional */ buildOpts) {
    log.info('Build database from nscan file %s', file);

    var stream = fs.createReadStream(file);
    if (isGzip)
        stream = stream.pipe(zlib.createGunzip());

    var reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    var np = parser.nscanParser(log.prefix);

    stream.on('aborted', () => reader.close());
    reader.on('line', (line) => parser.onNscanLine(np, line));
    reader.on('close', (line) => parser.onNscanClose(np));

    try { await events.once(reader, 'close'); }
    catch (e) {
        log.error('Failed to parse nscan file %s.', file, e);
        return false;
    }

    return getDbFromNscanDb(np.db, buildOpts);
}

/**
 * getDbFromNscanDb(ndb, buildOpts)
 * Build a database from nscan database <ndb>, which is an object resulting
 * of the parsing of an nscan file. The optional <buildOpts> object gets
 * passed as second argument to builder.runBuilders().
 * @return The database object on success.
 *     false on error.
 */
function getDbFromNscanDb(ndb, /* optional */ buildOpts) {
    var build;

    try { build = builder.runBuilders(ndb, buildOpts); }
    catch (e) {
        log.error('Exception while building database.', e);
        return false;
    }
    if (!build.result) {
        log.error('Failed to build database.');
        return false;
    }
    return build.db;
}

/* genid */

function getGenId(entity, path) {
    var genidDb = util.oget(CACHE, ['genid', entity]);
    if (!genidDb)
        genidDb = getGenIdDb(entity);
    var id = util.oget(genidDb, path);
    if (!id) {
        id = crypto.randomUUID();
        util.oset(genidDb, path, id);
    }
    return id;
}

function getGenIdDb(entity) {
    var genidDb = util.oget(CACHE, ['genid', entity]);
    if (!genidDb) {
        try {
            genidDb = fs.readFileSync(`${config.options.dataDir}/${entity}/.genid`);
            genidDb = JSON.parse(genidDb);
            if (!util.isObject(genidDb))
                throw Error('invalid data, not an object');
        }
        catch (e) {
            if (e.code != 'ENOENT')
                log.error('Failed to load genid database for %s.', entity, e);
            genidDb = {};
        }
        util.oset(CACHE, ['genid', entity], genidDb)
    }
    return genidDb;
}

function saveGenIdDb(entity) {
    log.debug('Save genid database for %s', entity);
    var data = util.oget(CACHE, ['genid', entity]);
    if (data) {
        let file = `${config.options.dataDir}/${entity}/.genid`;
        data = JSON.stringify(data);
        try { fs.writeFileSync(file, data); }
        catch (e) { log.error('Failed to save genid database for %s.', entity, e) }
    }
}

/* standalone json databases */

function getSnmpOidDb() {
    if (!CACHE.snmpOid) {
        let data;
        try {
            data = fs.readFileSync(config.options.snmpOidFile);
            data = JSON.parse(data);
            if (!util.isObject(data))
                throw Error('snmpOidFile has invalid JSON data');
        }
        catch (e) {
            log.error('Failed to load snmpOidFile.', e);
            data = {}; /* retry on next reload only */
        }
        /* merge local entries */
        if (config.options.snmp && config.options.snmp.oid)
            util.omerge(data, config.options.snmp.oid);
        CACHE.snmpOid = data;
    }
    return CACHE.snmpOid;
}

function getOuiDb() {
    if (!CACHE.oui) {
        let data;
        try {
            data = fs.readFileSync(config.options.ouiFile);
            data = JSON.parse(data);
            if (!util.isObject(data))
                throw Error('ouiFile has invalid JSON data');
        }
        catch (e) {
            log.error('Failed to load ouiFile.', e);
            data = {}; /* retry on next reload only */
        }
        CACHE.oui = data;
    }
    return CACHE.oui;
}

/* exports */

module.exports = {
    DB_SOURCES_EXT: Object.keys(DB_SOURCES),
    getDb,
    getDbList,
    getEntityList,
    getLatestDbId,
    getOuiDb,
    getSnmpOidDb,
    reload,
};
