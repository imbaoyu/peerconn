// Define external globals for JSHint
/*global WsConnectionState*/

///////////////////////////////////////////////////////////////////////////////////////////////////
/// BgConductor
/// Responsible for communication to the app itself
/// Using chrome.runtime.connect for websocket messages and chrome.runtime.sendMessage for control messages
///////////////////////////////////////////////////////////////////////////////////////////////////
function BgConductor() {
    'use strict';

    // Singleton pattern
    if (BgConductor.prototype._singletonInstance) {
        return BgConductor.prototype._singletonInstance;
    }
    BgConductor.prototype._singletonInstance = this;

    var _wsConnHandler = BgConnectionHandler.getInstance();

    // Cache user
    var _user;

    // Communication channels to app
    var _portControl;
    var _portWebsocket;

    function sendControlMessage(method, data) {
        _portControl.postMessage({method: method, data: data});
    }

    function sendWebSocketMessage(msg) {
        _portWebsocket.postMessage(msg);         
    }

    // Message handler for control messages from the app
    function controlMessageHandler(msg) {
        var method = msg.method;
        var data = msg.data;

        switch (method) {
            case 'connect':
            _wsConnHandler.connect(data.server, function (state, host) {
                sendControlMessage('connectionStateChange', {state: state, host: host});
            });
            break;
        }
    }

    // Message handler for websocket messages from the app - to be sent to server
    function websocketMessageHandler(msg) {
        var method = msg.method;
        var data = msg.data;

        switch (method) {
            case 'wsSignin':
            _user = data;
            break;
        }

        // Send over WebSocket to server
        _wsConnHandler.emit(msg);
    }

    // Listener for communication channel creation initiated by app. Two channels (aka ports)
    // are created: 'control' channel and 'websocket' channel
    chrome.runtime.onConnect.addListener(function (port) {
        console.log('App connect to background on port: ' + port.name);
        if (port.name === ChromeChannel.Control) {
            _portControl = port;
            _portControl.onMessage.addListener(controlMessageHandler);
        } else if (port.name === ChromeChannel.WebSocket) {
            _portWebsocket = port;
            _portWebsocket.onMessage.addListener(websocketMessageHandler);
        } else {
            console.error('Unhandled port ' + port.name);
        }
    });

    // ===========================================================
    // Public Functions
    // ===========================================================
    this.startApp = function (cb) {
        chrome.app.window.create('../chrome_app.html', {
            id: "peerconn app",
            singleton: true,
            width: 800,
            height: 800,
            minWidth: 500,
            minHeight: 600
        }, function (createdWindow) {
            cb && cb(createdWindow);
        });
    };

    // Send message to app
    this.sendMessage = function (msg) {
        // Intercept in NotificationHandler in case the app is not running
        BgNotificationHandler.getInstance().processMessage(msg);

        sendWebSocketMessage(msg);
    };

    this.getUser = function () {
        return _user;
    };


}

BgConductor.prototype.constructor = BgConductor;
BgConductor.prototype.name = 'BgConductor';

BgConductor.getInstance = function () {
    'use strict';
    var msgHandler = new BgConductor();
    return msgHandler;
};