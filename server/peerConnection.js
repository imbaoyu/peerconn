'use strict';

var common = require('./common');
var mediaHandler = require('./mediaHandler');

///////////////////////////////////////////////////////////////////////////////
// Logging
var Log = require('./logger').Log;
function logInfo(msg) { Log.info('[PEERCONN]: ' + msg); }
function logDebug(msg) { Log.debug('[PEERCONN]: ' + msg); }
function logWarning(msg) { Log.warning('[PEERCONN]: ' + msg); }
function logError(err) { Log.error(err.stack || ('[PEERCONN]: ' + err)); }
///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
// Registrations used by PeerConnection clients
/**
 * @param {object} data The data received in the wsConnect message
 * @param {object} socket True WebSocket wrapper created by the socket handler (socketHandler.js)
 */
function PCClientRegistration(data, socket) {
    this.user = data.user;
    this.device = data.device || 'unknown';
    this.ws = socket;
    this.activePeer = null;
    this.sessionId = null;
}

var pcRegistrations = {};
///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
//Event Handler for WebSocket requests
///////////////////////////////////////////////////////////////////////////////
function SocketHandler(socket) {
    // Data for PeerConnection client prototype
    var user = null; 

    // Messages used for simple PeerConnection client prototype (NO SIP interworking)
    socket.on('wsSignin', handleWsSignin);
    socket.on('wsSignout', handleWsSignout);
    socket.on('wsOffer', handleWsOffer);
    socket.on('wsAnswer', handleWsAnswer);
    socket.on('wsCandidate', handleWsCandidate);
    socket.on('wsDisconnect', handleWsDisconnect);
    socket.on('wsMessage', handleWsMessage);
    
    //------------------------------------------------------------------------- 
    // Public Functions
    //------------------------------------------------------------------------- 
    this.disconnect = function () {
        if (user) {
            logInfo('Socket has been disconnected. Unregister the current user (' + user + ')');
            signout();
        }
    };
    
    //------------------------------------------------------------------------- 
    // Event Handlers
    //------------------------------------------------------------------------- 
    function handleWsSignin(data) {
        try {
            logReceivedMsg('wsSignin', data);

            if (!data.user) {
                logWarning('Sign-In request is missing user name');
                sendNack('User name is missing');
                return;
            }
            
            if (user) {
                logWarning('There is already a User signed-in on this socket. Sign out before proceeding with the request.');
                signout();
            }
            user = data.user;

            // Check if user is already registered in a different socket
            if (pcRegistrations[user]) {
                logWarning('User is already signed-in on a different socket');
                sendNack('User is already signed in');
                return;
            }
    
            // Create new registration data
            var reg = new PCClientRegistration(data, socket);
            pcRegistrations[user] = reg;                
            logInfo('Sign-in was successful:' + common.inspect(reg, 1));
            sendAck();
            sendWsPeerList();
            
        } catch (e) {
            logError(e);
            sendNack('Internal Error');
        }
    }

    function handleWsSignout(data) {
        try {
            logReceivedMsg('wsSignout', data);
            signout();
        } catch (e) {
            logError(e);
        }
    }

    function handleWsOffer(data) {
        try {
            logReceivedMsg('wsOffer', data);

            var reg = getRegistration();
            if (!reg) {
                sendDisconnect(403, 'Forbidden (Not Signed In)');
                return;
            }
            logDebug('Found registration:' + common.inspect(reg, 1));

            if (!data.peer) {
                sendDisconnect(400, 'Request is Missing Peer');
                return;
            }
            if (data.peer === user) {
                sendDisconnect(486, 'Cannot call yourself!');
                return;
            }

            var peerReg = pcRegistrations[data.peer];

            if (reg.activePeer && (reg.activePeer !== data.peer)) {
                logWarning('Client started a new conversation without disconnecting the previous one.');
                // Disconnect the previous connection and continue
                disconnectCall(200, 'Normal Clearing');
            }

            if (!peerReg) {
                sendDisconnect(404, 'Peer is Not Connected');
                return;
            }
            if (peerReg.activePeer && (peerReg.activePeer !== user)) {
                // Peer is already in a conversation
                sendDisconnect(486, 'Busy Here');
                return;
            }

            // Set activePeer (if not already set)
            reg.activePeer = data.peer;

            if (data.useRtpProxy || reg.sessionId) {
                sendOfferViaRtpProxy(data, reg, peerReg);
            } else {
                // Set peer's activePeer (if not already set)
                peerReg.activePeer = user;

                logInfo('Sending the wsOffer to the peer');
                data.peer = user;
                peerReg.ws.sendMessage('wsOffer', data);
            }            
        } catch (e) {
            logError(e);
            sendDisconnect(500, 'Server Internal Error');
        }
    }

    function handleWsAnswer(data) {
        try {
            logReceivedMsg('wsAnswer', data);

            var reg = getRegistration();
            if (!reg) {
                sendDisconnect(403, 'Forbidden (Not Signed In)');
                return;
            }
            logDebug('Found registration:' + common.inspect(reg, 1));

            var peerReg = getPeerRegistration();
            if (!peerReg) {
                return;
            }

            if (reg.sessionId) {
                sendAnswerViaRtpProxy(data, reg, peerReg);
            } else {
                logInfo('Sending the wsAnswer to the peer');
                peerReg.ws.sendMessage('wsAnswer', data);
            }
        } catch (e) {
            logError(e);
        }
    }

    function handleWsCandidate(data) {
        try {
            logReceivedMsg('wsCandidate', data);

            var reg = getRegistration();
            if (!reg) {
                sendDisconnect(403, 'Forbidden (Not Signed In)');
                return;
            }
            logDebug('Found registration:' + common.inspect(reg, 1));

            if (reg.sessionId) {
                mediaHandler.handleCandidate(reg.sessionId, data.candidate);
            } else {
                var peerReg = getPeerRegistration();
                if (!peerReg) {
                    return;
                }
                logInfo('Sending the wsCandidate to the peer');
                peerReg.ws.sendMessage('wsCandidate', data);
            }
        } catch (e) {
            logError(e);
        }
    }

    function handleWsDisconnect(data) {
        try {
            logReceivedMsg('wsDisconnect', data);
            disconnectCall(data.status, data.reason);
        } catch (e) {
            logError(e);
        }
    }

    function handleWsMessage(data) {
        try {
            logReceivedMsg('wsMessage', data);

            if (!getRegistration()) {
                logWarning('User is not signed in. Ignore message.');
                return;
            }
            if (!data.peer) {
                logError('Request is Missing Peer');
                return;
            }

            var peerReg = pcRegistrations[data.peer];
            if (!peerReg) {
                // Cannot find peer
                logWarning('Peer is not signed in');
                return;
            }

            logInfo('Sending the wsMessage to the peer');
            data.peer = user;
            peerReg.ws.sendMessage('wsMessage', data);
            
        } catch (e) {
            logError(e);
        }
    }

    //------------------------------------------------------------------------- 
    // HELPER FUNCTIONS
    //------------------------------------------------------------------------- 
    function logReceivedMsg(msg, data) {
        logSocket('Received ' + msg + ' from ' + socket.clientAddress + common.inspect(data));
        logSocket('Registered User = ' + (user || '<None>'));
        
        function logSocket(txt) {
            logDebug('Socket(' + socket.id + '): ' + txt);
        }
    }

    function getRegistration() {
        if (!user) {
            logDebug('There is no User registered on this socket');
            return null;
        }

        var reg = pcRegistrations[user];
        if (!reg) {
            logError('Socket is out of synch. There is no registration for ' + user);
            user = null;
            return null;
        }
        if (reg.ws.id !== socket.id) {
            logWarning(user  + ' is registered with a different socket (id=' + reg.ws.id + ')');
            user = null;
            return null;
        }
        return reg;
    }

    function signout() {
        var reg = getRegistration();
        if (!reg) {
            return;
        }

        logInfo('Sign-Out ' + user);

        disconnectCall(200, 'Normal Clearing');
        delete pcRegistrations[user];
        user = null;
        sendWsPeerList();
    }
    
    function sendAck() {
        socket.sendMessage('wsSigninAck', {});         
    }

    function sendNack(error) {
        socket.sendMessage('wsSigninNack', {
            error : error
        });         
    }

    function sendDisconnect(status, reason) {
        socket.sendMessage('wsDisconnect', {
            status: status,
            reason: reason
        });

        if (status !== 403) {
            // Cleanup any stale data in the the current registration
            var reg = pcRegistrations[user];
            reg.activePeer = null;
            mediaHandler.deleteSession(reg.sessionId);
            reg.sessionId = null;
        }
    }

    function getPeerRegistration(ignoreError) {
        function disconnect(status, reason) {
            if (!ignoreError)  {
                sendDisconnect(status, reason);
            }
        }

        var reg = getRegistration();
        if (!reg) {
            disconnect(403, 'Forbidden (Not Signed In)');
            return null;
        }
        if (!reg.activePeer) {
            disconnect(481, 'No Active Conversation');
            return null;
        }

        logInfo('Peer User is ' + reg.activePeer);

        var peerReg = pcRegistrations[reg.activePeer];
        if (!peerReg) {
            disconnect(404, 'Peer is Not Connected');
            reg.activePeer = null;
            return null;
        }

        if (!peerReg.activePeer || (peerReg.activePeer !== user)) {
            // Peer is not in a conversation with the current user
            disconnect(500, 'No Conversation between User and Peer');
            reg.activePeer = null;
            return null;
        }
        logDebug('Found peer registration:' + common.inspect(peerReg, 1));
        return peerReg;
    }

    function sendWsPeerList() {
        var data = [], name;
        for (name in pcRegistrations) {
            if (pcRegistrations.hasOwnProperty(name)) {
                data.push({
                    user: name,
                    device: pcRegistrations[name].device
                });
            }
        }

        for (name in pcRegistrations) {
            if (pcRegistrations.hasOwnProperty(name)) {
                try {
                    var reg = pcRegistrations[name];
                    reg.ws.sendMessage('wsPeerList', data);
                } catch (e) {
                    logError(e);
                }
            }
        }
    }

    function disconnectCall(status, reason, disconnectSelf) {
        var reg = getRegistration();
        if (!reg) {
            return;
        }

        if (disconnectSelf) {
            socket.sendMessage('wsDisconnect', {status: status, reason: reason});
        }

        var peerReg = getPeerRegistration(true);
        if (peerReg) {
            logInfo('Sending the wsDisconnect to the peer');
            peerReg.ws.sendMessage('wsDisconnect', {status: status, reason: reason});

            peerReg.activePeer = null;
            mediaHandler.deleteSession(peerReg.sessionId);
            peerReg.sessionId = null;
        }

        reg.activePeer = null;
        mediaHandler.deleteSession(reg.sessionId);
        reg.sessionId = null;
    }

    function sendOfferViaRtpProxy(data, reg, peerReg) {
        reg.sessionId = reg.sessionId || common.genRandomString();

        try {
            mediaHandler.handleWebRtcOffer(reg.sessionId, socket.clientAddress, data.sdp.sdp, function (sdpOffer1) {
                // Make sure that the peer hasn't started a new call in the meantime
                if (peerReg.activePeer && (peerReg.activePeer !== user)) {
                    logWarning('The peer started a conversation while the server was waiting for the RTP Proxy');
                    sendDisconnect(486, 'Busy Here');
                    return;
                }

                peerReg.sessionId = peerReg.sessionId || common.genRandomString();

                mediaHandler.handleOSVOffer(peerReg.sessionId, sdpOffer1, function (sdpOffer2) {
                    // Make sure that the peer hasn't started a new call in the meantime
                    if (peerReg.activePeer && (peerReg.activePeer !== user)) {
                        logWarning('The peer started a conversation while the server was waiting for the RTP Proxy');
                        sendDisconnect(486, 'Busy Here');
                        return;
                    }
                    // Set peer's activePeer (if not already set)
                    peerReg.activePeer = user;

                    // Update SDP Offer in the wsOffer message
                    logInfo('Sending the wsOffer to the peer');
                    data.peer = user;
                    data.sdp.sdp = sdpOffer2;
                    peerReg.ws.sendMessage('wsOffer', data);
                    
                }, handleOfferError);
            }, handleOfferError, data.srtpInterwork);
        } catch (e) {
            logError(e);
            disconnectCall(500, 'Server Internal Error', true);
        }
    
        function handleOfferError(status, reason) {
            reason = reason || 'Server Internal Error';
            disconnectCall(status, reason, true);
        }
    }

    function sendAnswerViaRtpProxy(data, reg, peerReg) {
        if (data.sdp.type === 'pranswer') {
            logWarning('RTP Proxy does not support provisional SDP Answers. Ignore message.');
            return;
        }
        
        try {
            mediaHandler.handleWebRtcAnswer(reg.sessionId, socket.clientAddress, data.sdp.sdp, function (sdpAnswer1) {
                // Make sure that the peer hasn't started a new call in the meantime
                if (peerReg.activePeer && (peerReg.activePeer !== user)) {
                    logWarning('The peer started a conversation while the server was waiting for the RTP Proxy');
                    sendDisconnect(500, 'No Conversation between User and Peer');
                    return;
                }

                mediaHandler.handleOSVAnswer(peerReg.sessionId, sdpAnswer1, function (sdpAnswer2) {
                    if (peerReg.activePeer && (peerReg.activePeer !== user)) {
                        logWarning('The peer started a conversation while the server was waiting for the RTP Proxy');
                        sendDisconnect(500, 'No Conversation between User and Peer');
                        return;
                    }

                    // Update SDP Offer in the wsOffer message
                    data.sdp.sdp = sdpAnswer2;
                    logInfo('Sending the wsAnswer to the peer');
                    peerReg.ws.sendMessage('wsAnswer', data);

                }, handleAnswerError);
            }, handleAnswerError);
        } catch (e) {
            logError(e);
            disconnectCall(500, 'Server Internal Error', true);
        }

        function handleAnswerError(status, reason) {
            disconnectCall(status, reason, true);
        }
    }
}
exports.SocketHandler = SocketHandler;

