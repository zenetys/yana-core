"use strict";

const http = require('http');
const util = require(__dirname + '/util.js');

const Handler = require(__dirname + '/handler.js');
const Logger = require(__dirname + '/logger.js');
const log = new Logger('server');

const DEFAULTS = {
    listenAddress: '127.0.0.1',
    listenPort: 56789,
    maxClientErrors: 3,
    clientTimeout: 20000,
    maxConnections: 20,
}

/*
 * Handlers internal representation:
 * {
 *     GET: {
 *         entity: {
 *             '*': {
 *                 '*': {
 *                     '.': 'handler object for /entity/x/y' },
 *                     databases: 'handler object for /entity/x/y/databases' },
 *                     devices: 'handler object /entity/x/y/devices' },
 *                 }
 *             }
 *         }
 *     }
 * }
 */

/* These are custom property symbols added to the client socket objects.
 * ES6 Symbols are used to avoid naming conflicts. */
const SOCK_NAME = Symbol('srvClientName');
const SOCK_ERR = Symbol('srvClientErrors');
const SOCK_DESTROY_REASON = Symbol('srvClientDestroyReason');

function Server(options) {
    options = util.omerge({}, DEFAULTS, options);

    var self = this;
    var server = http.createServer();
    var sockets = {};
    var connections = 0;
    var handlers = {};

    function onError(err) {
        log.error('Server error:', err.message);
        self.stop();
    }

    function onListening() {
        var addr = this.address();
        log.info(`Server listening on ${addr.address}:${addr.port}`);
    }

    function onConnection(sock) {
        /* Name the socket, for shortcut in logs and mostly because the local
         * information isn't available anymore after close. */
        sock[SOCK_NAME] = sock.remoteAddress + ':' + sock.remotePort + ' ' +
            sock.localAddress + ':' + sock.localPort;
        sock[SOCK_ERR] = 0;
        connections++;
        sockets[sock[SOCK_NAME]] = sock;
        sock.on('close', onConnectionClose);
        log.debug(`${sock[SOCK_NAME]}, connection:`,
                  `${connections}/${options.maxConnections}`);
    }

    function onConnectionClose() {
        let that = this;
        log.debug(() => {
            let msg = 'connection closed';
            if (this[SOCK_DESTROY_REASON])
                msg += `, ${this[SOCK_DESTROY_REASON]}`;
            return `${this[SOCK_NAME]}, ${msg}`;
        });
        connections--;
        delete sockets[this[SOCK_NAME]];
    }

    function onClientError(err, sock) {
        sock[SOCK_ERR]++;
        log.error(`${sock[SOCK_NAME]}, client error:`,
                  `${sock[SOCK_ERR]}/${options.maxClientErrors}, ${err.code}`);
        if (sock[SOCK_ERR] >= options.maxClientErrors) {
            sock[SOCK_DESTROY_REASON] = 'too many errors';
            sock.destroy();
        }
    }

    function onTimeout(sock) {
        log.debug(`${sock[SOCK_NAME]}, client timeout:`,
                  `${options.clientTimeout} ms`);
        sock[SOCK_DESTROY_REASON] = 'client timeout';
        sock.destroy();
    }

    async function onRequest(req, res) {
        let start = new Date().getTime(), elapsed = 0;
        let urlPath, urlQs = req.url.indexOf('?');
        if (urlQs > -1) {
            urlPath = req.url.substr(0, urlQs);
            urlQs = Object.fromEntries(
                new URLSearchParams(req.url.substr(urlQs + 1)));
        }
        else {
            urlPath = req.url;
            urlQs = {};
        }
        let h = getHandler(req.method, urlPath);
        if (h.handler) {
            /* assume request handlers are proper objects */
            let ctx = { req, res, urlPath, urlParams: h.params, urlQs };
            let [e, result] = await util.safePromise(h.handler.handle(ctx));
            if (e) log.error(e);
        }
        else {
            res.writeHead(404);
            res.end();
        }

        /* make sure the server knows the response is complete */
        if (res.headersSent) {
            if (!res.writableEnded)
                res.end()
        }
        else {
            /* error catched or bad implementation because status code must
             * be implemented in handler */
            res.writeHead(500);
            res.end()
        }

        elapsed = new Date().getTime() - start;
        log.info(`${req.socket[SOCK_NAME]}, ${res.statusCode} ${elapsed}`,
                 `"${req.method} ${req.url} HTTP/${req.httpVersion}"`);
    }

    function onClose() {
        log.info('Server close');
    }

    function start() {
        if (!server.listening)
            server.listen(options.listenPort, options.listenAddress);
    }

    function stop() {
        if (!server.listening)
            return;
        server.close();
        for (let i in sockets)
            sockets[i].destroy();
    }

    /* Register a <handler> to a request <method> + <url>. The <url> must be
     * made of path components without a query string. The handler object is
     * expected to be an instance of Handler. When a path component of
     * <uri> is single character '*', it becomes a parameter.
     */
    function setHandler(method, url, handler) {
        if (!handlers[method])
            handlers[method] = {};

        var pathComponents = url.split('/');
        var pos = handlers[method];

        for (let i = 0, l = pathComponents.length; i < l; i++) {
            let c = pathComponents[i];

            if (c.length == 0)
                continue; /* pass empty component */

            if (pos[c]) { /* node or handler exists */
                if (i == l-1) { /* last */
                    if (typeof pos[c] == 'object')
                        pos[c]['.'] = handler; /* may override */
                    else
                    return; /* done */
                        pos[c] = handler; /* override */
                }
                else if (typeof pos[c] != 'object') {
                    pos[c] = { '.': pos[c] }; /* convert to node */
                }
            }
            /* node does not exist */
            else if (i == l-1) { /* last */
                pos[c] = handler;
                return; /* done */
            }
            else
                pos[c] = {} /* intermediate */

            pos = pos[c]; /* move forward */
        }

        /* special case for root */
        pos['.'] = handler;
    }

    /* Find the handler previously registered to process a request <method> +
     * <url>. The <url> passed to this function must not include the query
     * string. Returns an object with properties:
     * - "handler", the registered handler, or null of none was found
     * - "params", an array of strings representing the wildcard parameter
     *   values extracted from <url>.
     */
    function getHandler(method, url) {
        var out = { handler: null, params: [] }
        var pathComponents = url.split('/');

        if (pathComponents[0] != '')
            return out; /* must start with slash */
        if (!handlers[method])
            return out; /* method not registered */

        var pos = handlers[method];

        for (let c of pathComponents) {
            if (c.length == 0)
                continue; /* pass empty component */

            if (pos[c]) {
                pos = pos[c] /* pass match */
                continue;
            }
            if (pos['*']) {
                out.params.push(c);
                pos = pos['*']; /* pass parameter */
                continue;
            }

            return out; /* not registered */
        }

        if (util.isObject(pos)) {
            if (!pos['.'])
                return out; /* not registered */
            pos = pos['.'];
        }

        if (pos instanceof Handler)
            out.handler = pos; /* found handler */
        return out
    }

    server.on('error', onError);
    server.on('connection', onConnection);
    server.on('listening', onListening);
    server.on('request', onRequest);
    server.on('clientError', onClientError);
    server.on('timeout', onTimeout);
    server.on('close', onClose);

    server.timeout = options.clientTimeout;
    server.keepAliveTimeout = options.clientTimeout;
    server.maxConnections = options.maxConnections;

    /* Exposed methods */
    this.start = start;
    this.stop = stop;
    this.setHandler = setHandler;
}

module.exports = Server;
