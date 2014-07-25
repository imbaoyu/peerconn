// Define global variables for JSHint
/*global WsConnectionState*/

// ConnectionHandler wrapper for Chrome App to interface with  
// actual ConnectionHandler running as the background page.
// Interfaces must match the ConnectionHandler for the regular webapp
function ConnectionHandler() {
    'use strict';

    var _eventHandler = {};
    var _portControl;
    var _portWebsocket;

    // Maintain connection state in Chrome App process
    var _connectionState = WsConnectionState.Disconnected;

    // Singleton pattern
    if (ConnectionHandler.prototype._singletonInstance) {
        return ConnectionHandler.prototype._singletonInstance;
    }
    ConnectionHandler.prototype._singletonInstance = this;

    function sendControlMessage(method, data) {
        _portControl.postMessage({method: method, data: data});
    }

    function sendWebSocketMessage(method, data) {
        _portWebsocket.postMessage({method: method, data: data});         
    }

    // Setup channel to background page for control messages to communicate
    // between the app and the background pages
    _portControl = chrome.runtime.connect({name: ChromeChannel.Control});
    _portControl.onMessage.addListener(function (obj) {
        console.log('Message received from Background on channel ' + ChromeChannel.Control + ': ' + JSON.stringify(obj));
        var method = obj.method;
        var data = obj.data;

        var cb = _eventHandler[method];
        cb && cb(obj.data);
    });

    // Setup channel to background page for WebSocket messages communication
    // to the WebSocket server
    _portWebsocket = chrome.runtime.connect({name: ChromeChannel.WebSocket});
    _portWebsocket.onMessage.addListener(function (obj) {
        console.log('Message received from Background on channel ' + ChromeChannel.WebSocket + ': ' + JSON.stringify(obj));
        var method = obj.method;
        var data = obj.data;
        
        // For any ws (WebSocket) message invoke the registered callback.
        // ATTENTION: Only single listeners are supported in this demo application!
        var cb = _eventHandler[method];
        cb && cb(obj.data);
    });  

    // No channel messages, for example resuming the app where the channel is not yet ready
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        var method = request.method;
        var data = request.data;

        var cb = _eventHandler[method];
        cb && cb(data);
    });

    // Public Functions
    this.connect = function (wshost) {
        sendControlMessage('connect', {server: wshost});
    };

    this.on = function (eventName, callback) {
        _eventHandler[eventName] = callback;
    };

    this.emit = function (method, data) {
        sendWebSocketMessage(method, data);
    };  
}

ConnectionHandler.prototype.constructor = ConnectionHandler; 
ConnectionHandler.prototype.name = 'ConnectionHandler'; 

ConnectionHandler.getInstance = function () {
    'use strict'; 
    var connHandler = new ConnectionHandler();
    return connHandler;
};




