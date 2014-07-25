// Define global variables for JSHint
/*global angular, AppMode, chrome, ConnectionHandler, console, localStorage, require*/


(function () {
    'use strict';

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // *** Environment ***
    // Environment service
    ///////////////////////////////////////////////////////////////////////////////////////////////
    angular.module('myApp').factory('Environment', ['$rootScope', '$window', '$timeout', function ($rootScope, $window, $timeout) {

        var gui = null;
        var win = null;
        if (typeof(process) === 'object') {
            gui = require('nw.gui');
            win = gui.Window.get();
        }

        var _appMode = AppMode.BROWSER;
        if (chrome.app && chrome.app.runtime) {
            _appMode = AppMode.CHROME_APP;
        } else if (typeof(process) === 'object') {
            _appMode = AppMode.NODE_WEKBIT;
        }

        return {
            getAppMode : function () {
                return _appMode;
            },
            window: function () {
                if (_appMode === AppMode.CHROME_APP) {
                    return $window;
                } else if (_appMode === AppMode.NODE_WEKBIT && gui && gui.Window) {
                    return gui.Window.get();
                } else {
                    return $window;
                }
            },
            store: function (key, value) {
                if (_appMode === AppMode.CHROME_APP) {
                    var items = {};
                    items[key] = value;
                    chrome.storage.local.set(items, function() {
                        // Notify that we saved.
                        if (chrome.runtime.lastError) {
                            console.log('Error: ' + chrome.runtime.lastError);
                        } else {
                            console.log('Settings saved: ' + JSON.stringify(items));
                        }
                    });
                } else {
                    localStorage.setItem(key, value);
                }
            },
            retrieve: function (key, cb) {
                if (_appMode === AppMode.CHROME_APP) {
                    chrome.storage.local.get(key, function(items) {
                        // Notify that we saved.
                        console.log('Settings retrieved: ' + JSON.stringify(items));
                        $rootScope.$apply(function () {
                            cb && cb(items[key]);
                        });
                    });
                } else {
                    var val = localStorage.getItem(key);
                    $timeout(function () {
                        cb && cb(val);
                    }, 0);
                }
            }
        };
    }]);


    ///////////////////////////////////////////////////////////////////////////////////////////////
    // *** Socket ***
    // Socket service
    ///////////////////////////////////////////////////////////////////////////////////////////////
    angular.module('myApp').factory('Socket', ['Environment', '$rootScope', function (Environment, $rootScope) {
        // Use connHandler.js for regular webapp and connHandler_app.js for chrome app
        var _connHandler = ConnectionHandler.getInstance();

        return {
            connect: _connHandler.connect,
            getConnectionState: _connHandler.getConnectionState,
            on: function (eventName, callback) {
                _connHandler.on(eventName, function (data) {
                    if (callback) {
                        $rootScope.$apply(function () {
                            callback(data);
                        });
                    }
                });
            },
            emit: _connHandler.emit
        };
    }]);


    ///////////////////////////////////////////////////////////////////////////////////////////////
    // *** P2pSocket ***
    // P2pSocket service
    ///////////////////////////////////////////////////////////////////////////////////////////////
    angular.module('myApp').factory('P2pSocket', ['Socket', function (Socket) {
        var listeners = {};

        return {
            on: function (eventName, peer, callback) {
                if (!listeners[eventName]) {
                    listeners[eventName] = {};
                }

                if (!listeners[eventName][peer]) {
                    listeners[eventName][peer] = {};
                }

                listeners[eventName][peer] = callback;
                Socket.on(eventName, function (data) {
                    var cb = listeners[eventName][data.peer];
                    if (cb) {
                        cb(data);
                    }
                });
            },
            emit: function (method, data) {
                Socket.emit(method, data);
            }
        };
    }]);

}());