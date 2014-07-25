// Define external globals for JSHint
/*global WsConnectionState*/

///////////////////////////////////////////////////////////////////////////////////////////////////
/// BgNotificationHandler
/// Responsible to show the notifications and act upon them
///////////////////////////////////////////////////////////////////////////////////////////////////
function BgNotificationHandler() {
    'use strict';

    // Singleton pattern
    if (BgNotificationHandler.prototype._singletonInstance) {
        return BgNotificationHandler.prototype._singletonInstance;
    }
    BgNotificationHandler.prototype._singletonInstance = this;

    var _conductor = BgConductor.getInstance();

    // Should be a hashtable instead. Only save last one. Will not work with multiple notifications.
    var _savedMsg;	

    // Declare a variable to generate unique notification IDs
    var notID = 0;

    function resumeApp(data, cb) {
        chrome.app.window.create('../chrome_app.html', {
            id: "peerconn app",
            singleton: true,
            width: 800,
            height: 800,
            minWidth: 500,
            minHeight: 600
        }, function () {
            // Send cached data to app. Wait until the app is ready. 
            // There must be a better way than using timeout.
            window.setTimeout(function () {
            	// send direct w/o a channel since the channels have been disconnected
            	data = data || {};
            	data.user = _conductor.getUser();
				chrome.runtime.sendMessage({method: 'resumed', data: data});
            	console.log('resumed');
            	cb && cb();
            }, 1000);
        });
    }

    chrome.notifications.onClosed.addListener(function (notificationId, byUser) {
        console.log('notifications.onClosed');
    });

    chrome.notifications.onClicked.addListener(function (notificationId) {
        console.log('notifications.onClicked');
        resumeApp();
    });

    chrome.notifications.onButtonClicked.addListener(function (notificationId, buttonIndex) {
        console.log('notifications.onButtonClicked:' + notificationId + ', ' + buttonIndex);
        // Simple hack to differenciate calls vs IMs
        if (notificationId.indexOf('call') === 0 && buttonIndex === 0) {
        	// accept call
	        resumeApp({'accept': true, 'originalMsg': _savedMsg});
        } else {
        	resumeApp();
        }
    });

    // ===========================================================
    // Public Functions
    // ===========================================================
    this.processMessage = function (msg) {
        // Show notification for text message. Done here for Chrome App Background capabilities

        if (msg.method === 'wsMessage') {
        	 _savedMsg = msg;
            var options = {
                type: "basic",
                title: msg.data.peer,
                message: msg.data.text,
                iconUrl: "../img/rodrigo.png",
                buttons: [
                    { title: 'Reply', iconUrl: '../img/icon-chat-l@2x.png'},
                    { title: 'Call ' + msg.data.peer, iconUrl: '../img/icon-audio-call-button-l@2x.png'}
                ]
            };
            chrome.notifications.create("txt"+notID++, options, function (nId) {
                console.log("Succesfully created " + nId + " notification");
            });
        } else if (msg.method === 'wsOffer') {
        	 _savedMsg = msg;
            var options = {
                type: "basic",
                title: 'Incoming Call',
                message: 'From ' + msg.data.peer,
                iconUrl: "../img/rodrigo.png",
                buttons: [
                    { title: 'Accept Call', iconUrl: '../img/icon-conversation-header-video-grey_hover.png'},
                    { title: 'Decline Call', iconUrl: '../img/icon-conversation-button-phone-hand-up-charcoal75-xl.png'}
                ]
            };
            chrome.notifications.create("call"+notID++, options, function (nId) {
                console.log("Succesfully created " + nId + " notification");
            });
        }
    };
}

BgNotificationHandler.prototype.constructor = BgNotificationHandler;
BgNotificationHandler.prototype.name = 'BgNotificationHandler';

BgNotificationHandler.getInstance = function () {
    'use strict';
    var notiHandler = new BgNotificationHandler();
    return notiHandler;
};