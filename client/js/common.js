// Define global variables for JSHint

var WsConnectionState = Object.freeze({
    Disconnected: 'Disconnected',
    Connecting: 'Connecting',
    Reconnecting: 'Reconnecting...',
    Connected: 'Connected'
});
WsConnectionState = WsConnectionState; // Get rid of JSHint unused variable error

var ChromeChannel = Object.freeze({
    Control: 'control',
    WebSocket: 'websocket'
});
ChromeChannel = ChromeChannel; // Get rid of JSHint unused variable error

var AppMode = Object.freeze({
    BROWSER: 'Browser',
    CHROME_APP: 'ChromeApp',
    NODE_WEBKIT: 'node-webkit'
});
AppMode = AppMode; // Get rid of JSHint unused variable error