// Define external globals for JSHint
/*global WsConnectionState*/

///////////////////////////////////////////////////////////////////////////////////////////////////
/// WebSocket ConnectionHandler
/// Responsible for communication to server via websockets.
/// Must be part of background for chrome app to stay alive when app is closed.
///////////////////////////////////////////////////////////////////////////////////////////////////
function BgConnectionHandler() {
    'use strict';

    // Singleton pattern
    if (BgConnectionHandler.prototype._singletonInstance) {
        return BgConnectionHandler.prototype._singletonInstance;
    }
    BgConnectionHandler.prototype._singletonInstance = this;

    var RETRY_INTERVAL = 500; // Doubles on every retry until it reaches MAX_INTERVAL
    var MAX_INTERVAL = 32000;

    var ws;
    var retryInterval = RETRY_INTERVAL;
    var connectionState = WsConnectionState.Disconnected;
    var eventHandler = {};

    function startWsConnection(wsHost, cb) {
        var wsLoc = 'wss://' + wsHost;
        console.log('[BgConnectionHandler] Starting WebSocket Connection');
        connectionState = WsConnectionState.Connecting;
        ws = new WebSocket(wsLoc);

        ws.onopen = function (/*event*/) {
            console.log('[BgConnectionHandler] WebSocket - onopen');
            cb(WsConnectionState.Connected, wsHost);
            retryInterval = RETRY_INTERVAL;
        };

        ws.onclose = function (event) {
            console.log('[BgConnectionHandler] WebSocket - onclose: reason=' + event.reason + ', code=' + event.code);
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
            console.log('[BgConnectionHandler] WebSocket - onerror: reason=' + event.reason + ', code=' + event.code);
            cb(WsConnectionState.Disconnected);
        };

        ws.onmessage = function (message) {
            try {
                if (message.type !== 'message') {
                    return;
                }

                var msg = JSON.parse(message.data);
                console.assert(msg.method);
                console.log('[BgConnectionHandler] Received WS Message: ' + JSON.stringify(msg));

                // Forward message to app
                BgConductor.getInstance().sendMessage(msg);
            } catch (e) {
                console.log(e);
            }
        };
    }

    // ===========================================================
    // Public Functions
    // ===========================================================
    this.connect = function (wshost, connectionChangeCb) {
        if (connectionState === WsConnectionState.Connected) {
             console.log('[BgConnectionHandler] Already connected');
             return;
        }

        startWsConnection(wshost, function (wsState, wsHost) {
            connectionState = wsState;
            connectionChangeCb && connectionChangeCb(wsState, wsHost);
            console.log('[BgConnectionHandler] Connection State: ' + connectionState);
        });
    };

    this.emit = function (obj) {
        var msg = JSON.stringify(obj);
        ws.send(msg);
        console.log('[BgConnectionHandler] Sent WS Message: ' + msg);
    }
}

BgConnectionHandler.prototype.constructor = BgConnectionHandler;
BgConnectionHandler.prototype.name = 'BgConnectionHandler';

BgConnectionHandler.getInstance = function () {
    'use strict';
    var wsConnHandler = new BgConnectionHandler();
    return wsConnHandler;
};