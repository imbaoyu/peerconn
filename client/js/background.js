// Define global variables for JSHint
/*global chrome BgConnectionHandler BgConductor BgNotificationHandler*/

var appWindow;
var conductor;

(function () {
    'use strict';

    chrome.app.runtime.onLaunched.addListener(function (/*launchData*/) {
        console.log('runtime.onLaunched');
        var manifest = chrome.runtime.getManifest();
        console.log("Manifest: " + JSON.stringify(manifest));

        // Start conductor and launch app
        conductor = BgConductor.getInstance();
        conductor.startApp(function (createdWindow) {
            //createdWindow.contentWindow.showKeyboard = showKeyboard;
            appWindow = createdWindow;
        });
    });

    chrome.app.window.onRestored.addListener(function() {
        console.log('window.onRestored');
    });

    chrome.app.window.onClosed.addListener(function() {
        console.log('window.onClosed');
    });

    chrome.runtime.onInstalled.addListener(function () {
        console.log('runtime.onInstalled');
    });

    chrome.runtime.onSuspend.addListener(function () {
        console.log('runtime.onSuspend');
    });

    // Having fun with chrome.alarms
    chrome.alarms.create('coffee-time', {
        periodInMinutes: 10
    });

    chrome.alarms.onAlarm.addListener(function(alarm) {
        if (alarm.name == 'coffee-time') {
            console.log('coffee-time expiry');
            var options = {
                type: 'basic',
                title: 'Coffee Time!',
                message: 'You have been working hard. Go get yourself a coffee.',
                iconUrl: '../img/coffee.jpg'
            };
            chrome.notifications.create("coffee-id", options, function (nId) {
                console.log("Succesfully created " + nId + " notification");
            });
        }
    });
}());