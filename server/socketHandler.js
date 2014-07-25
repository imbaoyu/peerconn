'use strict';

//Load Node.js modules
var io = require('socket.io');
var WebSocketServer = require('websocket').server;

var common = require('./common');


///////////////////////////////////////////////////////////////////////////////
// Logging
var Log = require("./logger").Log;

function logInfo(msg) { Log.info('[SOCKET]: ' + msg); }
function logDebug(msg) { Log.debug('[SOCKET]: ' + msg); }
function logWarning(msg) { Log.warning('[SOCKET]: ' + msg); }
function logError(err) { Log.error(err.stack || ('[SOCKET]: ' + err)); }
///////////////////////////////////////////////////////////////////////////////


function start(socketType, httpServer, AppSocketHandler) {
    switch (socketType) {
    case 'socket.io':
        startSocketIO(httpServer, AppSocketHandler);
        break;
    case 'websocket':
        startWebSocket(httpServer, AppSocketHandler);
        break;
    default:
        logError('Invalid socket type');
        break;
    } 
}
exports.start = start;


function startSocketIO(httpServer, AppSocketHandler) {
    var socketManager = io.listen(httpServer);    
    socketManager.enable('browser client minification');        // send minified client
    socketManager.set('transports', ['websocket']);             // only websocket
    socketManager.set('log level', 1);                          // reduce logging

    socketManager.configure('production', function () {
        socketManager.enable('browser client etag');            // apply etag caching logic based on version number
        socketManager.enable('browser client gzip');            // gzip the file
        logInfo('Socket.IO in production mode: cache and gzip js for client');
    });

    socketManager.sockets.on('connection', function (socket) {
        var clientAddress = socket.manager.handshaken[socket.id].address.address;
        var socketId = common.rstring();
        logInfo('New WebSocket. Client  = ' + clientAddress + ', Socket ID = ' + socketId);
        
        var socketWrapper = {
            sendMessage: function (msg, data) {
                logInfo('Sending ' + msg + ' to ' + 
                    clientAddress + ' (id=' + socketId + ')' + common.inspect(data));
                socket.emit(msg, data);
            },
            on: function (eventName, callback) {
                socket.on(eventName, callback);
            },
            id: socketId,
            clientAddress: clientAddress
        };

        var appHandler = new AppSocketHandler(socketWrapper);

        socket.on('disconnect', function () {
            logInfo('The Socket to ' + clientAddress + ' (id=' + socket.id + ') has been disconnected');
            if (appHandler.disconnect) {
                appHandler.disconnect();
            }
            appHandler = null;
        });
    });

    logInfo('Started WebSocket server using Socket.IO');
}


function startWebSocket(httpServer, AppSocketHandler) {
    // WebSocket server is tied to a HTTP server. WebSocket request is just
    // an enhanced HTTP request (RFC6455).
    // See https://github.com/Worlize/WebSocket-Node/wiki/Documentation

    var wsServer = new WebSocketServer({
        httpServer: httpServer
    });

    wsServer.on('request', function (request) {
        var clientAddress = request.remoteAddress;
        var socketId = common.rstring();
        logInfo('New WebSocket. Client  = ' + clientAddress + ', Socket ID = ' + socketId);

        // accept connection - you should check 'request.origin' to make sure that
        // client is connecting from your website
        // (http://en.wikipedia.org/wiki/Same_origin_policy)
        var connection = request.accept(null, request.origin);
        logDebug('Accepted WebSocket connection');

        var eventHandler = {};

        var socketWrapper = {
            sendMessage: function (method, data) {
                logDebug('Sending ' + method + ' to ' + 
                    clientAddress + ' (id=' + this.id + ')' + common.inspect(data));

                var wsMessage = JSON.stringify({method: method, data: data});
                connection.sendUTF(wsMessage);
            },
            on: function (eventName, callback) {
                eventHandler[eventName] = callback;
            },
            id: socketId,
            clientAddress: clientAddress
        };

        var appHandler = new AppSocketHandler(socketWrapper);

        connection.on('message', function (message) {
            try {
                logDebug('Received message from ' + clientAddress + common.inspect(message));
                if (message.type !== 'utf8') {
                    return;
                }

                var msg = JSON.parse(message.utf8Data);
                    
                if (!msg.method) {
                    logError("Method is missing");
                    return;
                }

                var callback = eventHandler[msg.method];
                if (!callback) {
                    logWarning('Method not supported: ' + msg.method);
                    return;
                }
                callback(msg.data);
            } catch (e) {
                logError(e);
            }
        });
        
        connection.on('close', function () {
            logInfo('The Socket to ' + clientAddress + ' (id=' + socketId + ') has been disconnected');

            if (appHandler) {
                if (appHandler.disconnect) {
                    appHandler.disconnect();
                }
            }

            appHandler = null;
            eventHandler = null;
        });
    });

    logInfo('Started WebSocket server using plain WebSockets [RFC6455]');
}
