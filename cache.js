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

const DB_SOURCES = {
    'nscan': async (f, ...rest) => await getDbFromNscanFile(f, false, ...rest),
    'nscan.gz': async (f, ...rest) => await getDbFromNscanFile(f, true, ...rest),
};

/* core */

/**
 * reload()
 * Flush and reinit cache.
 */
function reload() {
    log.debug('Cache reload');
    Object.keys(CACHE).forEach(k => delete CACHE[k]);
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
    getOuiDb,
    reload,
};
