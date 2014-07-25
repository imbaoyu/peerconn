// Define global variables for JSHint
/*global console, WebSocket, window, WsConnectionState*/

function ConnectionHandler() {
    'use strict';

    // Singleton pattern
    if (ConnectionHandler.prototype._singletonInstance) {
        return ConnectionHandler.prototype._singletonInstance;
    }
    ConnectionHandler.prototype._singletonInstance = this;

    var RETRY_INTERVAL = 500; // Doubles on every retry until it reaches MAX_INTERVAL
    var MAX_INTERVAL = 32000;
    var ws;
    var retryInterval = RETRY_INTERVAL;
    var connectionState = WsConnectionState.Disconnected;
    var eventHandler = {};

    function startWsConnection(wsLoc, cb) {
        console.log('[SOCKET] Starting WebSocket Connection');
        connectionState = WsConnectionState.Connecting;
        ws = new WebSocket(wsLoc);

        ws.onopen = function (/*event*/) {
            console.log('[SOCKET] WebSocket - onopen');
            cb(WsConnectionState.Connected);
            retryInterval = RETRY_INTERVAL;
        };

        ws.onclose = function (event) {
            console.log('[SOCKET] WebSocket - onclose: reason=' + event.reason + ', code=' + event.code);
            if (connectionState === WsConnectionState.Connected) {
                if (eventHandler.disconnect) {
                    eventHandler.disconnect();
                }
            }
            cb(WsConnectionState.Reconnecting);
            window.setTimeout(function () {
                startWsConnection(wsLoc, cb);
            }, retryInterval);
            retryInterval = retryInterval * 2;
            if (retryInterval > MAX_INTERVAL) {
                retryInterval = MAX_INTERVAL;
            }
        };

        ws.onerror = function (event) {
            // Not really sure what triggers this, but auto reconnect likely does not help
            console.log('[SOCKET] WebSocket - onerror: reason=' + event.reason + ', code=' + event.code);
            cb(WsConnectionState.Disconnected);
        };

        ws.onmessage = function (message) {
            try {
                if (message.type !== 'message') {
                    return;
                }

                var msg = JSON.parse(message.data);
                console.log('Received Message: ' + JSON.stringify(msg));

                if (!msg.method) {
                    console.log('Method is missing');
                    return;
                }

                var callback = eventHandler[msg.method];
                if (!callback) {
                    console.log('Method not supported: ' + msg.method);
                } else {
                    callback(msg.data);
                }
            } catch (e) {
                console.log(e);
            }
        };
    }

    // Public Functions
    this.connect = function (wshost, cbDone) {
        if (connectionState === WsConnectionState.Connected) {
            console.log('[SOCKET] Already connected');
            cbDone && cbDone();
            return;
        }

        startWsConnection('wss://' + wshost, function (wsState) {
            connectionState = wsState;

            if (wsState === WsConnectionState.Connected) {
                cbDone && cbDone();
            } else if (wsState === WsConnectionState.Disconnected) {
                cbDone && cbDone('Cannot connect to server');
            }

            if (eventHandler.connectionStateChange) {
                eventHandler.connectionStateChange({state: wsState, host: wshost});
            }

            console.log('[SOCKET] Connection State: ' + connectionState);
        });
    };

    this.on = function (eventName, callback) {
        eventHandler[eventName] = callback;
    };

    this.emit = function (method, data) {
        var obj = {
            method: method,
            data: data
        };
        ws.send(JSON.stringify(obj));
    };

}

ConnectionHandler.prototype.constructor = ConnectionHandler;
ConnectionHandler.prototype.name = 'ConnectionHandler';

ConnectionHandler.getInstance = function () {
    'use strict';
    var connHandler = new ConnectionHandler();
    return connHandler;
};




