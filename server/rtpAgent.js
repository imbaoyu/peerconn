// The code in this file is the same as the one in the WOSMO project

'use strict';

var assert = require('assert');
var dgram = require('dgram');
var common = require('./common.js');

/////////////////////////////////////////////////////////////////////////////////
//Logging
var Log = require('./logger').Log;

function logInfo(msg) { Log.info('[RTP]: ' + msg); }
function logDebug(msg) { Log.debug('[RTP]: ' + msg); }
function logWarning(msg) { Log.warning('[RTP]: ' + msg); }
function logError(err) { Log.error(err.stack || ('[RTP]: ' + err)); }
///////////////////////////////////////////////////////////////////////////////


var SP = ' ';
var COOKIE_LEN = 15;      // Length of the cookie sent in the requests to the RTPProxy
var RTPP_TIMEOUT = 4000;  // Timeout value (ms) for the response from the RTPProxy

var rtpProxyAddress;
var rtpProxyPort;
var client; // The UDP socket client


function StunData(localName, remoteName, remoteAddress, remotePort) {
    this.localName = localName;
    this.username = remoteName;
    this.address = remoteAddress;
    this.port = remotePort;
}
exports.StunData = StunData;


// transactions store the cookie --> {type, cb, timeout} map
var transactions = {};

exports.start = function (address, port) {
    assert.ok(address);
    port = port || 22222;
    rtpProxyAddress = address;
    rtpProxyPort = port;
    client = dgram.createSocket('udp4');
    client.on('message', handleRtpResponse);
    logDebug('Started RTPProxy agent. RTPProxy listening at ' + address + ':' + port);
};


function sendRtpCommand(type, command, cb) {
    var cookie = common.genRandomString(COOKIE_LEN);
    var buffer = new Buffer(cookie + ' ' + command);

    logInfo('Sending Command to RTP Proxy. Type = ' + type + 
        ', Command = ' + cookie + ' ' + command + '\r\n');
    
    transactions[cookie] = {
        type: type,
        cb: cb,
        timeout: setTimeout(function () {
            handleRtpResponse(cookie + ' E99');
        }, RTPP_TIMEOUT)
    };
    
    client.send(buffer, 0, buffer.length, rtpProxyPort, rtpProxyAddress);
}


function handleRtpResponse(msg) {
    logInfo('Received Response - ' + msg);

    // Parse the response to get cookie
    var words = msg.toString().replace(/(\r\n|\n|\r)/gm, SP).replace(/\s+/g, SP).split(SP);
    var cookie = words[0];
    
    var t = transactions[cookie];
    if (!t) {
        logError('There is no pending transaction for ' + cookie);
        return;
    }

    // Clear the transaction timeout
    clearTimeout(t.timeout);

    if (!t.cb) {
        logWarning('No callback to handle RTPProxy response');
        return;
    }       

    var retCode = handleError(words[1]);
    if (retCode !== 'SUCCESS') {
        t.cb(retCode);
        return;
    }

    // Parse response according to different command types
    switch (t.type)
    {
    case 'GET_VERSION':
        // return 1-version number
        t.cb(retCode, words[1]);
        break;

    case 'UPDATE_SESSION':
    case 'LOOKUP_SESSION':
        // return 1-port, 2-ip addr 
        t.cb(retCode, words[1], words[2]);
        break;

    case 'CLOSE_ACTIVE_SESSIONS':
    case 'DELETE_SESSION':
    case 'NEW_CANDIDATE':
    case 'START_PLAYBACK':
    case 'STOP_PLAYBACK':
    case 'START_RECORDING':
    case 'START_COPYING':        
        t.cb(retCode);
        break;
    
    case 'GET_SESSION_STATS':
        t.cb(retCode, msg); 
        break;

    case 'GET_SESSION_DETAIL':
        // return   1-ttl, 2-packets from callee, 3-packets from caller, 
        //      4-packets relayed, 5-packtes dropped
        t.cb(retCode, words[1], words[2], words[3], words[4], words[5]);
        break;

    default:
        logError('Unexpected request type: ' + t.type);
        break;
    }

    // delete the cookie from transaction list
    delete transactions[cookie];
}


function handleError(errorCode) {
    var returnCode = 'SUCCESS';
    if (errorCode) {
        switch (errorCode) {
        case 'E0':
        case 'E1':
        case 'E2':
            returnCode = errorCode + ' - Syntax error';
            break;
        case 'E3':
            returnCode = errorCode + ' - Unknown command';
            break;
        case 'E4':
            returnCode = errorCode + ' - URL encoding error';
            break;
        case 'E6':
            returnCode = errorCode + ' - Can not play media. Possibly wrong codec';
            break;
        case 'E7':
            returnCode = errorCode + ' - Update session fail. Can not create listen socket';
            break;
        case 'E8':
            returnCode = errorCode + ' - Can not find session or tag';
            break;
        case 'E10':
            returnCode = errorCode + ' - Create new session fail. Can not create listen socket';
            break;
        case 'E11':
        case 'E12':
        case 'E13':
            returnCode = errorCode + ' - No memory error';
            break;
        case 'E99':
            returnCode = 'Request timeout. RTPProxy did not respond';
            break;
        default:
            // Not an error;
            break;
        }
    }
    return returnCode; 
}
 

function getVersion(cb) {
    sendRtpCommand('GET_VERSION', 'V', cb);    
}
exports.getVersion = getVersion;


function getSessionStats(cb) {
    sendRtpCommand('GET_SESSION_STATS', 'I', cb);  
}
exports.getSessionStats = getSessionStats; 


function closeActiveSessions(cb) {
    sendRtpCommand('CLOSE_ACTIVE_SESSIONS', 'X', cb);  
}
exports.closeActiveSessions = closeActiveSessions;


function updateSession(session, addr, port, cb) {
    var command = (session.srtp && session.srtp.useProxy) ? 'UK' : 'U';
    command += SP + [session.callId, addr, port, session.fromTag].join(SP) + SP;
    if (session.srtp && session.srtp.useProxy) {
        command += buildSrtpData(session.srtp);
    }   
    
    sendRtpCommand('UPDATE_SESSION', command, cb); 
}
exports.updateSession = updateSession; 
    

function updateSessionIce(session, cb) {
    var command = (session.srtp && session.srtp.useProxy) ? 'UUK' : 'UU';
    
    var addr = '0.0.0.0';
    var port = 1;
    if (session.remoteCandidates.rtp && session.remoteCandidates.rtp[0]) {
        addr = session.remoteCandidates.rtp[0].address;
        port = session.remoteCandidates.rtp[0].port;
    } 
    var iceL = buildIceLocal(session.localCandidates);
    var iceR = buildIceRemote(session.remoteCandidates);

    command += SP + [session.callId, addr, port, session.fromTag, iceL, iceR].join(SP);

    if (session.srtp && session.srtp.useProxy) {
        command += buildSrtpData(session.srtp);
    }   

    sendRtpCommand('UPDATE_SESSION', command, cb); 
}
exports.updateSessionIce = updateSessionIce; 
    

function lookupSession(session, addr, port, cb) {
    var command = (session.srtp && session.srtp.useProxy) ? 'LK' : 'L';
    command += SP + [session.callId, addr, port, session.fromTag, session.toTag].join(SP) + SP;
    if (session.srtp && session.srtp.useProxy) {
        command += buildSrtpData(session.srtp);
    }   
    
    sendRtpCommand('LOOKUP_SESSION', command, cb); 
}
exports.lookupSession = lookupSession; 


function lookupSessionIce(session, cb) {
    var command = (session.srtp && session.srtp.useProxy) ? 'LUK' : 'LU';
    
    var addr = '0.0.0.0';
    var port = 1;
    if (session.remoteCandidates.rtp && session.remoteCandidates.rtp[0]) {
        addr = session.remoteCandidates.rtp[0].address;
        port = session.remoteCandidates.rtp[0].port;
    } 
    var iceL = buildIceLocal(session.localCandidates);
    var iceR = buildIceRemote(session.remoteCandidates);

    command += SP + [session.callId, addr, port, session.fromTag, session.toTag, iceL, iceR].join(SP);

    if (session.srtp && session.srtp.useProxy) {
        command += buildSrtpData(session.srtp);
    }   

    sendRtpCommand('LOOKUP_SESSION', command, cb); 
}
exports.lookupSessionIce = lookupSessionIce; 
    
    
function newCandidate(originatingSide, callid, fromTag, toTag, candidate, cb) {    
    var command = 'W';
    if (originatingSide) {
        command += ['U', callid, fromTag, getCandidateInfo(candidate)].join(SP);
    } else {
        command += ['L', callid, fromTag, toTag, getCandidateInfo(candidate)].join(SP);        
    }
    sendRtpCommand('NEW_CANDIDATE', command, cb); 
}
exports.newCandidate = newCandidate; 


function deleteSession(callid, fromTag, toTag, cb) {
    var command = ['D', callid, fromTag, toTag || 'null'].join(SP) + SP;
    sendRtpCommand('DELETE_SESSION', command, cb); 
}
exports.deleteSession = deleteSession; 
    
    
function startPlayback(callid, playName, codecs, fromTag, toTag, cb) {    
    var command = ['P', callid, playName, codecs, fromTag, toTag].join(SP) + SP;
    sendRtpCommand('START_PLAYBACK', command, cb); 
}
exports.startPlayback = startPlayback; 
    
    
function stopPlayback(callid, fromTag, toTag, cb) {    
    var command = ['S', callid, fromTag, toTag].join(SP) + SP;
    sendRtpCommand('STOP_PLAYBACK', command, cb);  
}
exports.stopPlayback = stopPlayback; 
    
    
function startRecording(callid, fromTag, toTag, cb) {    
    var command = ['R', callid, fromTag, toTag].join(SP) + SP;
    sendRtpCommand('START_RECORDING', command, cb);    
}
exports.startRecording = startRecording;


function startCopying(callid, copyTarget, fromTag, toTag, cb) {
    var command = ['C', callid, copyTarget, fromTag, toTag].join(SP) + SP;
    sendRtpCommand('START_COPYING', command, cb);  
}
exports.startCopying = startCopying;


function getSessionDetail(callid, fromTag, toTag, cb) {
    var command = ['Q', callid, fromTag, toTag].join(SP) + SP;
    sendRtpCommand('GET_SESSION_DETAIL', command, cb); 
}
exports.getSessionDetail = getSessionDetail;


function buildIceLocal(iceLocal) {
    var str = 'iceL:' + iceLocal.ufrag + ',' + iceLocal.pwd + SP;
    return str;
}


function getCandidateInfo(candidate) {
    var info = candidate.isRtp() ? 'iceRtpR:' : 'iceRtcpR:';
    info += candidate.address + ',' + candidate.port + ',' + candidate.priority + SP;
    return info;
}


function buildIceRemote(iceRemote) {
    var str = 'iceR:' + iceRemote.ufrag + ',' + iceRemote.pwd + SP;
    if (iceRemote.rtp) {
        iceRemote.rtp.forEach(function (candidate) {
            str += getCandidateInfo(candidate);
        });
    }
    if (iceRemote.rtcp) {
        iceRemote.rtcp.forEach(function (candidate) {
            str += getCandidateInfo(candidate);
        });
    }
    return str; 
}


function buildSrtpData(srtp) {
    function getInfo(sdes) {
        var suite = 0;
        switch (sdes.cryptoSuite) {
        case 'AES_CM_128_HMAC_SHA1_80':
            suite = 1;
            break;
        case 'AES_CM_128_HMAC_SHA1_32':
            suite = 2;
            break;
        case 'F8_128_HMAC_SHA1_80':
            suite = 3;
            break;
        }        
        
        return sdes.keySalt.toString('hex') + ',' + sdes.ssrc + ',' + suite + SP;
    }
    
    var str = '';
    if (srtp.send) {
        str += 'send:' + getInfo(srtp.send);
    }
    if (srtp.rcv) {
        str += 'rcv:' + getInfo(srtp.rcv);
    }
    if (srtp.psend) {
        str += 'psend:' + getInfo(srtp.psend);
    }
    if (srtp.prcv) {
        str += 'prcv:' + getInfo(srtp.prcv);
    }
    return str;
}
