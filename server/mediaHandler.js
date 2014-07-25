// This code is based on the code in sdpMapping.js file in the WOSMO project. 
// The changes from the original code have been marked with [PC]

'use strict';

var common = require('./common');
var rtpagent = require('./rtpAgent');
var sdpMapping = require('./sdpMapping');

var IceCandidate = sdpMapping.IceCandidate;
var SdesData = sdpMapping.SdesData;


/////////////////////////////////////////////////////////////////////////////////
// Logging
var Log = require("./logger").Log;

function logInfo(msg, obj) { Log.info('[MEDIA]: ' + msg, obj); }
function logDebug(msg, obj) { Log.debug('[MEDIA]: ' + msg, obj); }
function logWarning(msg, obj) { Log.warning('[MEDIA]: ' + msg, obj); }
function logError(err, obj) { Log.error(err.stack || ('[MEDIA]: ' + err), obj); }
///////////////////////////////////////////////////////////////////////////////


var sessionId = 1;

///////////////////////////////////////////////////////////////////////////////
//RTP Proxy Session object
///////////////////////////////////////////////////////////////////////////////
function RtpProxySession(callId, ufrag, pwd) {
    this.callId = callId;
    this.fromTag = common.generateTag();  // [PC]
    this.toTag = common.generateTag();    // [PC]
    
    this.localCandidates = {
        ufrag: ufrag || sdpMapping.generateUserName(),
        pwd: pwd || sdpMapping.generateUserName(),
        rtp: new IceCandidate(true, null, null),
        rtcp: new IceCandidate(false, null, null)
    };    
    this.remoteCandidates = null;

    // This field contains an object with the following fields:
    // - rcv: The key info used to decrypt the SRTP packets FROM the Offerer
    // - send: The info used to encrypt the SRTP packets TO the Answerer
    // - prcv: The key info used to decrypt the SRTP packets FROM the Answerer
    // - send: The info used to encrypt the SRTP packets TO the Offerer
    // (See RFC3264 for definition of Offerer and Answerer)
    this.srtp = {
        useProxy: false,
        rcv: null,
        send: null,
        prcv: null,
        psend: null
    };

    this.ssrc = null;
}

RtpProxySession.prototype.updateCandidates = function (address, portStr) {
    var port = parseInt(portStr, 10);
    this.localCandidates.rtp.address = address;
    this.localCandidates.rtp.port = port;
    this.localCandidates.rtcp.address = address;
    this.localCandidates.rtcp.port = port + 1;
};


///////////////////////////////////////////////////////////////////////////////
//Media Session object
///////////////////////////////////////////////////////////////////////////////
function MediaSession(callId, isOutgoingCall) {
    this.outgoing = isOutgoingCall;
    this.callId = callId;

    this.ufrag = sdpMapping.generateUserName();
    this.pwd = sdpMapping.generateUserName();

    // Audio is mandatory and Video is optional
    this.audio = new RtpProxySession(callId, this.ufrag, this.pwd);
    this.video = null;

    // Stores the original connections received in the SIP SDP Offer.
    // This is required so we keep the order and the number of m-lines in the SDP Answer.
    this.origConn = null;
    
    // Session ID and Version ID to be used in the SDPs
    // The version ID must be set to 2 to indicate support for google-ICE attribute
    this.id = sessionId++;
    this.version = 2;
}

MediaSession.prototype.createVideoSession = function () {
    if (!this.video) {
        this.video = new RtpProxySession(this.callId, this.ufrag, this.pwd);
    }
};

MediaSession.prototype.hasSsrc = function () {
    return (this.audio.ssrc !== null);
};

MediaSession.prototype.generateSsrc = function (isOffer) {
    var cname = 'sen' + common.genRandomString(13);
    var mslabel = 'sen' + common.genRandomString(33);

    generateSsrcForRtpSession(this.audio, '00');
    generateSsrcForRtpSession(this.video, '10');

    function generateSsrcForRtpSession(rtpSession, label) {
        if (!rtpSession) { return; }

        var ssrcId = 0;
        if (isOffer) {
            if (rtpSession.srtp.rcv && rtpSession.srtp.rcv.ssrc) {
                // OSV SDP Offer already has SSRC
                rtpSession.ssrc = null;
                return;
            }
            ssrcId = rtpSession.srtp.send && rtpSession.srtp.send.ssrc;
        } else {
            if (rtpSession.srtp.prcv && rtpSession.srtp.prcv.ssrc) {
                // OSV SDP Answer already has SSRC
                rtpSession.ssrc = null;
                return;
            }
            ssrcId = rtpSession.srtp.psend && rtpSession.srtp.psend.ssrc;
        }

        rtpSession.ssrc = {
            id: ssrcId || common.rinteger(),
            cname: cname,
            mslabel: mslabel,
            label: mslabel + label
        };
    }
};

/**
 * This function analyzes the SRTP data stored in the session to see if we need to 
 * use the RTP Proxy to interwork SRTP.
 * @param {object} session The Media Session object.
 * @param {bool} isOfferer True if the WebRTC client was the Offerer, False if it was the Answerer
 */
MediaSession.prototype.checkSrtpInterworking = function (isOfferer) {
    function checkSrtpData(srtp) {
        srtp.useProxy = false;
        if (isOfferer) {
            // SRTP stream from WebRTC to SIP UA is controlled by the rcv and send parameters
            // SRTP stream from SIP UA to WebRTC is controlled by the prcv and psend parameters
            if (!srtp.prcv) {
                // The Answerer doesn't support SRTP. Interwork SRTP <> RTP
                srtp.useProxy = true;
                srtp.send = null;
            } else if (srtp.prcv.ssrc === 0) {
                // The Answerer supports SRTP, but it didn't publish its SSRC id in the SDP Answer
                // Interwork SRTP <> SRTP
                srtp.useProxy = true;
                if (srtp.rcv === srtp.send) {
                    // Let SRTP pass transparently in the direction WebRTC to SIP UA
                    srtp.rcv = srtp.send = null;
                }
            }

        } else {
            // SRTP stream from WebRTC to SIP UA is controlled by the prcv and psend parameters
            // SRTP stream from SIP UA to WebRTC is controlled by the rcv and send parameters
            if (!srtp.rcv) {
                // The Offerer doesn't support SRTP. Interwork SRTP <> RTP
                srtp.useProxy = true;
                srtp.psend = null;
            } else if (srtp.rcv.ssrc === 0) {
                // The Offerer supports SRTP, but it didn't publish its SSRC id in the SDP Offer
                // Interwork SRTP <> SRTP
                srtp.useProxy = true;
                if (srtp.prcv === srtp.psend) {
                    // Let SRTP pass transparently in the direction WebRTC to SIP UA
                    srtp.prcv = srtp.psend = null;
                }
            }
        }
    }

    checkSrtpData(this.audio.srtp);
    logDebug('SRTP Interworking Data for Audio: ', this.audio.srtp);
    if (this.video) {
        checkSrtpData(this.video.srtp);
        logDebug('SRTP Interworking Data for Video: ', this.video.srtp);
    }
};

MediaSession.prototype.clearSrtp = function () {
    this.audio.srtp = {
        useProxy: false,
        rcv: null,
        send: null,
        prcv: null,
        psend: null
    };
    if (this.video) {
        this.video.srtp = {
            useProxy: false,
            rcv: null,
            send: null,
            prcv: null,
            psend: null
        };
    }
};

MediaSession.prototype.clearSsrc = function () {
    this.audio.ssrc = null;
    if (this.video) {
        this.video.ssrc = null;
    }
};

MediaSession.prototype.reset = function () {
    this.clearSrtp();
    this.clearSsrc();
    this.audio.remoteCandidates = null;
    if (this.video) {
        this.video.remoteCandidates = null;
    }
};


// Object to keep track of all existing media connections
var mediaSessions = {};


///////////////////////////////////////////////////////////////////////////////
//Public Interfaces
///////////////////////////////////////////////////////////////////////////////
function deleteSession(callId) {
    if (!callId) { return; }
    
    var session = mediaSessions[callId];
    if (session) {
        logInfo('Delete RTP Proxy Session(s) for Call-Id = ' + callId);
        deleteRtpSession(session.audio);
        deleteRtpSession(session.video);
        delete mediaSessions[callId];
    }
}
exports.deleteSession = deleteSession;


function handleCandidate(callId, rtcCandidate) {
    if (!callId) { return; }

    var session = null;
    var rtpSession = null;
    var iceCandidate = null;

    try {
        logDebug('Received WebRTC Candidate:', rtcCandidate);

        session = mediaSessions[callId];
        if (!session) {
            // Something went wrong!
            logError('Cannot find media session for ' + callId);
            return;
        }

        if (!session[rtcCandidate.sdpMid]) {
            // Something else went wrong!
            logError('There is no RTPProxy session for ' + rtcCandidate.sdpMid);
            return;
        }
        rtpSession = session[rtcCandidate.sdpMid];
        
        iceCandidate = new IceCandidate();
        iceCandidate.parse(rtcCandidate.candidate);
        
        rtpagent.newCandidate(session.outgoing, callId, rtpSession.fromTag, rtpSession.toTag, iceCandidate);

    } catch (e) {
        logError(e);
    }
}
exports.handleCandidate = handleCandidate;


// [PC] The removeSrtp parameter has been added for the PeerConnection project 
// to allow removing the secure m-line (RTP/SAVP) from the generated offer. This is 
// used to force the SRTP<->RTP<->SRTP interworking in the RTPProxy.
function handleWebRtcOffer(callId, clientAddress, sdpOffer, onModifiedSdp, onError, removeSrtp) {
    if (!callId) { return; }

    var session = null, modifiedSdp = null;
    try {
        logDebug('Received WebRTC SDP Offer:\r\n' + sdpOffer);
        
        var parsedSdp = sdpMapping.parseWebRtcSdp(sdpOffer, clientAddress);
        if (!parsedSdp) {
            onError(420, 'Bad Request (Invalid SDP)');
            return;
        }

        // Cleanup the received WebRTC SDP
        sdpMapping.cleanupWebRtcSdp(parsedSdp, clientAddress);
        logDebug('Cleaned-up WebRTC SDP:', parsedSdp);

        // See if this is a new session or if we are supposed to update an existing session 
        session = mediaSessions[callId];
        if (!session) {
            // Create new Media Session to handle RTP Proxy connections
            session = new MediaSession(callId, true);
            mediaSessions[callId] = session;
        }
        // Reset the session data in case this is an existing session
        // The data for the session will be re-populated according the new SDP Offer/Answer exchange 
        session.reset();

        handleWebRtcSdp(true, session, parsedSdp, onError, function (address, audioPort, videoPort) {
            try {
                modifiedSdp = sdpMapping.buildSipSdpOffer(parsedSdp, address, audioPort, videoPort, removeSrtp);  //[PC]
                if (!modifiedSdp) {
                    throw new Error('Failed to build SDP Offer');
                }
                
                logInfo('Modified SDP Offer:\r\n' + modifiedSdp);

                // Send the modified SDP to the callback function. Set the directCall parameter to false.
                onModifiedSdp(modifiedSdp, false);
            }
            catch (e) {
                logError(e);
                deleteSession(callId);
                onError(500);
            }
        });
    } catch (e) {
        logError(e);
        deleteSession(callId);
        onError(500);
    }
}
exports.handleWebRtcOffer = handleWebRtcOffer;


function handleWebRtcAnswer(callId, clientAddress, sdpAnswer, onModifiedSdp, onError) {
    if (!callId) { return; }

    var session = null, modifiedSdp = null;
    try {
        logDebug('Received WebRTC SDP Answer:\r\n' + sdpAnswer);

        var parsedSdp = sdpMapping.parseWebRtcSdp(sdpAnswer, clientAddress);
        if (!parsedSdp) {
            onError(420, 'Bad Request (Invalid SDP)');
            return;
        }

        // Cleanup the received WebRTC SDP
        sdpMapping.cleanupWebRtcSdp(parsedSdp, clientAddress);
        logDebug('Cleaned-up WebRTC SDP:', parsedSdp);

        session = mediaSessions[callId];
        if (!session) {
            // There is no RTP Proxy session, so this must be a WebRTC to WebRTC call
            modifiedSdp = sdpMapping.stringify(parsedSdp);              
            logDebug('Modified SDP Answer:\r\n' + modifiedSdp);

            // Send the modified SDP to the callback function. Set the directCall parameter to true.
            onModifiedSdp(modifiedSdp, true);
            return;
        }

        handleWebRtcSdp(false, session, parsedSdp, onError, function (address, audioPort, videoPort) {
            try {
                var conn = session.origConn;
                session.origConn = null;

                conn.address = address;
                conn.audio.port = audioPort;
                if (conn.video) {
                    conn.video.port = videoPort;
                }

                modifiedSdp = sdpMapping.buildSipSdpAnswer(parsedSdp, conn);
                if (!modifiedSdp) {
                    throw new Error('Failed to build SDP Answer');
                }
                
                logDebug('Modified SDP Answer:\r\n' + modifiedSdp);

                // Send the modified SDP to the callback function. Set the directCall parameter to false.
                onModifiedSdp(modifiedSdp, false);
            }
            catch (e) {
                logError(e);
                deleteSession(callId);
                onError(500);
            }
        });
    } catch (e) {
        logError(e);
        deleteSession(callId);
        onError(500);
    }
}
exports.handleWebRtcAnswer = handleWebRtcAnswer;


function handleWebRtcOfferNoProxy(clientAddress, sdpOffer, onModifiedSdp, onError) {
    var modifiedSdp = null;
    try {
        logDebug('Received WebRTC SDP Offer:\r\n' + sdpOffer);

        var parsedSdp = sdpMapping.parseWebRtcSdp(sdpOffer, clientAddress);
        if (!parsedSdp) {
            onError(420, 'Bad Request (Invalid SDP)');
            return;
        }

        // Cleanup the received WebRTC SDP
        sdpMapping.cleanupWebRtcSdp(parsedSdp, clientAddress);
        logDebug('Cleaned-up WebRTC SDP:', parsedSdp);

        modifiedSdp = sdpMapping.stringify(parsedSdp);              
        logDebug('Modified SDP Offer:\r\n' + modifiedSdp);

        // Send the modified SDP to the callback function. Set the directCall parameter to true.
        onModifiedSdp(modifiedSdp, true);

    } catch (e) {
        logError(e);
        onError(500);
    }
}
exports.handleWebRtcOfferNoProxy = handleWebRtcOfferNoProxy;


function handleOSVOffer(callId, sdpOffer, onModifiedSdp, onError) {
    if (!callId) { return; }

    var session = null, modifiedSdp = null;
    try {
        logDebug('Received OSV SDP Offer:\r\n' + sdpOffer);
        
        if (sdpMapping.isWebRtcSdp(sdpOffer)) {
            logInfo('WebRTC to WebRTC call. Bypass RTP Proxy.');
            deleteSession(callId);

            modifiedSdp = sdpMapping.restoreWebRtcSdp(sdpOffer);
            logInfo('Modified SDP Offer for WebRTC\r\n' + modifiedSdp);

            // Send the modified SDP to the callback function. Set the directCall parameter to true.
            onModifiedSdp(modifiedSdp, true);
            return;
        }
        
        // See if this is a new session or if we are supposed to update an existing session 
        session = mediaSessions[callId];
        if (!session) {
            // Create new Media Session to handle RTP Proxy connections
            session = new MediaSession(callId, false);
            mediaSessions[callId] = session;
        }
        // Reset the session data in case this is an existing session
        // The data for the session will be re-populated according the new SDP Offer/Answer exchange 
        session.reset();

        handleOSVSdp(true, session, sdpOffer, onError, onModifiedSdp);
    }
    catch (e) {
        logError(e);
        deleteSession(callId);
        onError(500);
    }
}
exports.handleOSVOffer = handleOSVOffer;


function handleOSVAnswer(callId, sdpAnswer, onModifiedSdp, onError) {
    if (!callId) { return; }

    var session = null, modifiedSdp = null;
    try {
        logDebug('Received OSV SDP Answer:\r\n' + sdpAnswer);

        if (sdpMapping.isWebRtcSdp(sdpAnswer)) {
            logInfo('WebRTC to WebRTC call. Remove RTP proxy from the path.');
            deleteSession(callId);

            modifiedSdp = sdpMapping.restoreWebRtcSdp(sdpAnswer);
            logInfo('Modified SDP Answer for WebRTC\r\n' + modifiedSdp);
            
            // Send the modified SDP to the callback function. Set the directCall parameter to true.
            onModifiedSdp(modifiedSdp, true);
            return; 
        } 
                
        // There must be an active RTP Proxy session for this case. 
        session = mediaSessions[callId];
        if (!session) {
            // Something went wrong!
            logError('Cannot find media session for ' + callId);
            onError(500);
            return;
        }

        handleOSVSdp(false, session, sdpAnswer, onError, onModifiedSdp);

    } catch (e) {
        logError(e);
        deleteSession(callId);
        onError(500);
    }
}
exports.handleOSVAnswer = handleOSVAnswer;


///////////////////////////////////////////////////////////////////////////////
//Internal Functions
///////////////////////////////////////////////////////////////////////////////
function deleteRtpSession(rtpSession) {
    if (rtpSession) { 
        try {
            logInfo('Delete RTP Proxy Session for Call-Id = ' + rtpSession.callId + ' and From-Tag = ' + rtpSession.fromTag);
            rtpagent.deleteSession(rtpSession.callId, rtpSession.fromTag, null, function (ret) {
                logInfo('Deleted RTP Proxy session (' + ret + ')');
            });
        } catch (e) {
            logError(e);
        }
    }
}


function handleWebRtcSdp(isOffer, session, parsedSdp, onError, onSuccess) {
    try {
        var audioAddress = null;
        var audioPort = -1;
        var videoPort = -1;
        var sentError = false;

        var candidates = sdpMapping.getCandidates(parsedSdp);
        logDebug('Selected ICE Candidates:', candidates);
        if (!candidates.audio) {
            logError('SDP does not have valid ICE candidates for audio');   
            handleFailure(420, 'Bad Request (Missing Audio Candidates)');
            return;
        }
        
        var sdes = sdpMapping.getSdesData(parsedSdp);
        logDebug('SDES Data:', sdes);
        if (!sdes.audio) {
            logError('SDP does not have SDES with AES_CM_128_HMAC_SHA1_80');    
            handleFailure(420, 'Bad Request (Missing SDES Data)');
            return;
        }
        
        session.audio.remoteCandidates = candidates.audio;
        if (isOffer) {
            session.audio.srtp.rcv = session.audio.srtp.send = sdes.audio;
        } else {
            session.audio.srtp.prcv = session.audio.srtp.psend = sdes.audio;
        }
        logDebug('Set SRTP data for audio:', session.audio.srtp);

        if (candidates.video && sdes.video) {
            // The SDP has audio & video.
            if (!isOffer && !session.video) {
                // How can the SDP Answer include video if it was not offered? 
                logError('SDP Answer cannot add a new media stream');
                handleFailure(488);
                return;
            }            
            session.createVideoSession();
            session.video.remoteCandidates = candidates.video;
            if (isOffer) {
                session.video.srtp.rcv = session.video.srtp.send = sdes.video;
            } else {
                session.video.srtp.prcv = session.video.srtp.psend = sdes.video;
            }
            logDebug('Set SRTP data for video:', session.video.srtp);

        } else {
            // The SDP only has audio. Delete the RTP Proxy Session for video if existing. 
            deleteRtpSession(session.video);
            session.video = null;
            videoPort = 0;
        }
        if (!isOffer) {
            session.checkSrtpInterworking(false);
        }

        sendMessageForWebRtcSdp(session.outgoing, session.audio, function (ret, port, address) {
            if (ret !== 'SUCCESS') {
                logError('RTP Proxy Failure (' + ret + ')');
                handleFailure();
            } else if (!sentError) {
                logInfo('Received Audio IP Address and Port from RTP Proxy = ' + address + ':' + port);
                audioAddress = address;
                audioPort = port;
                if (videoPort >= 0) {
                    onSuccess(audioAddress, audioPort, videoPort);
                } else {
                    logDebug('Waiting for RTP proxy response for video session');
                }
            }
        });

        if (session.video) {
            sendMessageForWebRtcSdp(session.outgoing, session.video, function (ret, port, address) {
                if (ret !== 'SUCCESS') {
                    logError('RTP Proxy Failure (' + ret + ')');
                    handleFailure();
                } else if (!sentError) {
                    logInfo('Received Video IP Address and Port from RTP Proxy = ' + address + ':' + port);
                    videoPort = port;
                    if (audioPort >= 0) {
                        onSuccess(audioAddress, audioPort, videoPort);
                    } else {
                        logDebug('Waiting for RTP proxy response for audio session');
                    }
                }
            });
        }
    } catch (e) {
        logError(e);
        handleFailure();
    }
    
    function handleFailure(status, reason) {
        if (!sentError) {
            sentError = true;
            deleteSession(session);
            onError(status || 500, reason);
        }
    }
}


function sendMessageForWebRtcSdp(isOutgoing, rtpSession, callback) {
    if (isOutgoing) {         
        // Send Update Session request for WebRTC SDPs
        rtpagent.updateSessionIce(rtpSession, callback);              
    } else {
        // Send Lookup Session request for WebRTC SDPs
        rtpagent.lookupSessionIce(rtpSession, callback);
    }
}


function handleOSVSdp(isOffer, session, sdp, onError, onModifiedSdp) {
    try {
        var audioAddress = null;
        var audioPort = -1;
        var videoPort = -1;
        var sentError = false;

        var parsedSdp = sdpMapping.parse(sdp);
        sdpMapping.cleanupSipSdp(parsedSdp);
        logDebug('Cleaned-up SIP SDP:', parsedSdp);

        var conn = sdpMapping.getConnections(parsedSdp);
        logDebug('Connections:', conn);
        if (isOffer) {
            // Save connections. Will need that later to build the SIP SDP Answer
            session.origConn = conn;
        }

        if (!conn.audio) {
            logError('Unsupported SIP SDP Offer');
            handleFailure(488);
            return;
        }
        setSdesDataFromOSV(isOffer, conn.audio.sdes, session.audio);
        logDebug('Set SRTP data for audio:', session.audio.srtp);

        if (conn.video) {
            if (!isOffer && !session.video) {
                // How can the SDP Answer include video if it was not offered? 
                logError('SDP Answer cannot add a new media stream');
                handleFailure(488);
                return;
            }            
            // The SDP has audio & video.
            session.createVideoSession();
            setSdesDataFromOSV(isOffer, conn.video.sdes, session.video);
            logDebug('Set SRTP data for video:', session.video.srtp);
        } else {
            // The SDP only has audio. Delete the RTP Proxy Session for video if existing. 
            deleteRtpSession(session.video);
            session.video = null;
            videoPort = 0;
        }

        if (!isOffer) {
            session.checkSrtpInterworking(true);
        }

        var sdpAddress = conn.audio.address || conn.address;
        var sdpPort = conn.audio.port;

        sendMessageForOsvSdp(session.outgoing, session.audio, sdpAddress, sdpPort, function (ret, port, address) {
            if (ret !== 'SUCCESS') {
                logError('RTP Proxy Failure (' + ret + ')');
                handleFailure();
            } else if (!sentError) {
                logInfo('Received Audio IP Address and Port from RTP Proxy = ' + address + ':' + port);
                audioAddress = address;
                audioPort = port;
                if (videoPort >= 0) {
                    modifySdp();
                } else {
                    logDebug('Waiting for RTP proxy response for video session');
                }
            }
        });       

        if (session.video) {
            sdpAddress = conn.video.address || conn.address;
            sdpPort = conn.video.port;

            sendMessageForOsvSdp(session.outgoing, session.video, sdpAddress, sdpPort, function (ret, port, address) {
                if (ret !== 'SUCCESS') {
                    logError('RTP Proxy Failure (' + ret + ')');
                    handleFailure();
                } else if (!sentError) {
                    logInfo('Received Video IP Address and Port from RTP Proxy = ' + address + ':' + port);
                    videoPort = port;
                    if (audioPort >= 0) {
                        modifySdp();
                    } else {
                        logDebug('Waiting for RTP proxy response for audio session');
                    }
                }
            });
        }
    } catch (e) {
        logError(e);
        handleFailure();
    }
    
    function modifySdp() {
        try {
            // Update the address and port for the local candidates
            session.audio.updateCandidates(audioAddress, audioPort);
            if (session.video) {
                session.video.updateCandidates(audioAddress, videoPort);
            }

            var candidates = {
                audio: session.audio.localCandidates,
                video: session.video && session.video.localCandidates
            };
            logDebug('Local ICE candidates:', candidates);

            var sdes = {
                audio: isOffer ? session.audio.srtp.send : session.audio.srtp.psend, 
                video: session.video ? (isOffer ? session.video.srtp.send : session.video.srtp.psend) : null
            };
            logDebug('Local SDES data:', sdes);

            // Generate the SSRC data if required
            session.generateSsrc(isOffer);

            var ssrc = {
                audio: session.audio.ssrc,
                video: session.video && session.video.ssrc
            };
            logDebug('Local SSRC data:', ssrc);

            // Set the SDP's session ID and version ID
            parsedSdp.o.id = session.id;
            parsedSdp.o.version = session.version++;            

            var modifiedSdp = sdpMapping.buildWebRtcSdp(parsedSdp, conn, candidates, sdes, ssrc);
            if (!modifiedSdp) {
                logError('Unable to build SDP for WebRTC');
                deleteSession(session.callId);
                onError(500);
                return;
            } 
            logInfo('Modified SDP for WebRTC\r\n' + modifiedSdp);

            // Send the modified SDP to the callback function
            onModifiedSdp(modifiedSdp, false);
        } catch (e) {
            logError(e);
            handleFailure();
        }
    }

    function handleFailure(status, reason) {
        if (!sentError) {
            sentError = true;
            deleteSession(session.callId);
            onError(status || 500, reason);
        }
    }
}


function setSdesDataFromOSV(isOffer, remoteSdes, rtpSession) {
    var localSdes = null;
    if (remoteSdes) {
        // Remote SDP has SDES
        if (remoteSdes.ssrc) {
            // SDP has SDES and SSCR. No interworking needed
            if (isOffer) {
                rtpSession.srtp.rcv = rtpSession.srtp.send = remoteSdes;
            } else {
                rtpSession.srtp.prcv = rtpSession.srtp.psend = remoteSdes;
            }
        } else {
            logWarning('SDP has SRTP/SDES, but does not have SSRC. Need interworking.');
            localSdes = new SdesData();
            localSdes.tag = remoteSdes.tag;
            localSdes.ssrc = common.rinteger();
            if (isOffer) {
                rtpSession.srtp.rcv = remoteSdes;
                rtpSession.srtp.send = localSdes;
            } else {
                rtpSession.srtp.prcv = remoteSdes;
                rtpSession.srtp.psend = localSdes;
            }
        }
    } else {
        logWarning('SDP does not contain SRTP/SDES. Need interworking.');
        localSdes = new SdesData();
        localSdes.ssrc = common.rinteger();
        if (isOffer) {
            rtpSession.srtp.rcv = null;
            rtpSession.srtp.send = localSdes;
        } else {
            localSdes.tag = rtpSession.srtp.rcv.tag;
            rtpSession.srtp.prcv = null;
            rtpSession.srtp.psend = localSdes;
        }
    }
}


function sendMessageForOsvSdp(isOutgoing, rtpSession, address, port, callback) {
    if (isOutgoing) {
        // Send Lookup Session request for WebRTC SDPs 
        rtpagent.lookupSession(rtpSession, address, port, callback);

    } else {
        // Send Update Session request for WebRTC SDPs 
        rtpagent.updateSession(rtpSession, address, port, callback);
    }
}
