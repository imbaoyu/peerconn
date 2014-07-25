// Define external globals for JSHint
/*global WsConnectionState*/

///////////////////////////////////////////////////////////////////////////////////////////////////
/// BgMessagingHandler
/// Responsible for communication to the app itself
/// Using chrome.runtime.connect for websocket messages and chrome.runtime.sendMessage for control messages
///////////////////////////////////////////////////////////////////////////////////////////////////
function BgMessagingHandler() {
    'use strict';

    // Singleton pattern
    if (BgMessagingHandler.prototype._singletonInstance) {
        return BgMessagingHandler.prototype._singletonInstance;
    }
    BgMessagingHandler.prototype._singletonInstance = this;

    var _wsConnHandler = BgConnectionHandler.getInstance();
    var _user;
    var _portControl;
    var _portWebsocket;

    function sendControlMessage(method, data) {
        _portControl.postMessage({method: method, data: data});
    }

    function sendWebSocketMessage(msg) {
        _portWebsocket.postMessage(msg);         
    }

    function controlMessageHandler(msg) {
        var method = msg.method;
        var data = msg.data;

        switch (method) {
            case 'connect':
            _wsConnHandler.connect(data.server, function (state) {
                sendControlMessage('connectionStateChange', state);
            });
            break;
        }
    }

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

BgMessagingHandler.prototype.constructor = BgMessagingHandler;
BgMessagingHandler.prototype.name = 'BgMessagingHandler';

BgMessagingHandler.getInstance = function () {
    'use strict';
    var msgHandler = new BgMessagingHandler();
    return msgHandler;
};