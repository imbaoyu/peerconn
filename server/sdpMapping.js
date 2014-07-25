// This code is based on the code in sdpMapping.js file in the WOSMO project. 
// The changes from the original code have been marked with [PC]


'use strict';

//Node.js modules
var assert = require('assert');

//WOSMO modules
var common = require('./common');
var sdpParser = require('./sdp');

var SP = ' ';
var SESSION_NAME = 'WebRTC';

/////////////////////////////////////////////////////////////////////////////////
//Logging
var Log = require("./logger").Log;

//function logInfo(msg) { Log.info('[SDP]: ' + msg); }
function logDebug(msg, obj) { Log.debug('[SDP]: ' + msg, obj); }
function logWarning(msg, obj) { Log.warning('[SDP]: ' + msg, obj); }
function logError(err, obj) { Log.error(err.stack || ('[SDP]: ' + err), obj); }
///////////////////////////////////////////////////////////////////////////////


function isSdes(m) {
    if (m.proto !== 'RTP/SAVP') {
        return false;
    }
    
    for (var idx = 0; idx < m.a.length; idx++) {
        if (m.a[idx].field === 'crypto') {
            return true;
        }
    }   
    return false;
}


function parse(sdp) {
    return sdpParser.parse(sdp);
}
exports.parse = parse;


function stringify(parsedSdp) {
    return sdpParser.stringify(parsedSdp);
}
exports.stringify = stringify;


function isWebRtcSdp() {
    return false;  // [PC]
}
exports.isWebRtcSdp = isWebRtcSdp;


function generateUserName() {
    return 'SEN' + common.rstring();
}
exports.generateUserName = generateUserName;


function parseWebRtcSdp(inputSdp, clientAddress) {
    // 1. Parse the SDP
    var parsedSdp = sdpParser.parse(inputSdp);
    
    // 2. Set the session name
    parsedSdp.s = SESSION_NAME;

    // 3. Set the originator address
    if (clientAddress) {
        parsedSdp.o.address = clientAddress;
    }

    var hasAudio = false;
    parsedSdp.m.forEach(function (m) {
        if (m.media !== 'audio' && m.media !== 'video') {
            return;
        }
        
        if (m.media === 'audio') {
            hasAudio = true;
        }

        /*
        m.a = m.a.filter(function (a) {
            if (a.field === 'ssrc') {
                // Remove non-standard ssrc attributes
                //  a=ssrc:<ssrc-id> <attribute>
                //  a=ssrc:<ssrc-id> <attribute>:<value>
                // RFC5576 defines three attributes: cname, previous-ssrc, fmtp
                var tmp = /^(\d+) ([^:]+)(?::(.*))?/.exec(a.value);
                if (!tmp || !tmp[2]) {
                    return false;
                }
                if (tmp[2] !== 'cname' && tmp[2] !== 'previous-ssrc' && tmp[2] !== 'ftmp') {
                    return false;
                }
            }
            return true;
        });
        */
    });
    
    // 4. Make sure there is a media description for audio
    if (!hasAudio) {
        logError('The WebRTC SDP does not have audio');
        return null;
    }
    
    return parsedSdp;
}
exports.parseWebRtcSdp = parseWebRtcSdp;


function cleanupWebRtcSdp(parsedSdp, clientAddress) {

    // Add the c-line at the session level
    parsedSdp.c = {
        nettype: 'IN',
        addrtype: 'IP4',
        address: clientAddress
    };

    // Traverse the media descriptions
    parsedSdp.m.forEach(function (m) {
        if (m.media !== 'audio' && m.media !== 'video') {
            return;
        }
        // Set the port to 9999. 
        // This will be changed later once we have the RTP Proxy port
        m.port = 9999;

        // Change the audio/video transport protocol from 'RTP/SAVPF' to 'RTP/SAVP'
        m.proto = 'RTP/SAVP';

        // Remove the Connection Information ('c=')
        // The 'c=' line will be added later at the session level
        delete m.c;
                
        m.a = m.a.filter(function (a) {
            switch (a.field) {
            case 'candidate':
                // Filter the ICE candidates
                var candidate = new IceCandidate();
                candidate.parse(a.value);               
                if ((candidate.transport !== 'udp') ||
                    (candidate.typ === 'host' && candidate.address !== clientAddress)) {
                    return false;
                }                
                break;

            case 'mid':
            case 'rtcp':
            case 'rtcp-mux':
                // Remove these attributes
                return false;
            }
            return true;
        });
    });
}
exports.cleanupWebRtcSdp = cleanupWebRtcSdp;


function cleanupSipSdp(parsedSdp) {
    if (parsedSdp.a) {
        parsedSdp.a = parsedSdp.a.filter(function (a) {
            switch (a.field) {
            case 'ice-ufrag':
            case 'ice-pwd':
            case 'ice-options':
            case 'key-mgmt':
                return false;
            }
            return true;
        });
    }

    parsedSdp.m.forEach(function (m) {
        if (m.media !== 'audio' && m.media !== 'video') {
            return;
        }
        if (m.port === 0 || !m.a) {
            return;
        }
        
        m.a = m.a.filter(function (a) {
            switch (a.field) {
            case 'candidate':
            case 'ice-ufrag':
            case 'ice-pwd':
            case 'ice-options':
            case 'ice-mismatch':
            case 'rtcp':
            case 'rtcp-mux':
            case 'key-mgmt':
                // Remove these attributes
                return false;

            case 'crypto':
                // WebRTC doesn't like the lifetime crypto parameter sent by the Media Server
                var lifetimePattern = /\|2\^20/;
                a.value = a.value.replace(lifetimePattern, '');
                break;
            }
            return true;
        });
    });
}
exports.cleanupSipSdp = cleanupSipSdp;

/*
 * This function returns an object with the ICE candidates from 
 * the WebRTC client.
 * audio
 *   ufrag
 *   pwd
 *   rtp - The ICE candidates for Audio RTP
 *   rtcp - The ICE candidates for Audio RTCP
 * video
 *   ufrag
 *   pwd
 *   rtp - The ICE candidates for Video RTP
 *   rtcp - The ICE candidates for Video RTCP
 */
function getCandidates(parsedSdp) {
    var candidates = {};
        
    // Check if ice-ufrag and ice-pwd are at the session level
    var ufrag = null;
    var pwd = null;
    if (parsedSdp.a) {
        parsedSdp.a.forEach(function (a) {
            switch (a.field) {
            case 'ice-ufrag':
                ufrag = a.value;
                break;

            case 'ice-pwd':
                pwd = a.value;
                break;
            }   
        });
    }

    parsedSdp.m.forEach(function (m) {
        if (m.media !== 'audio' && m.media !== 'video') {
            return;
        }
        
        if (candidates[m.media] && candidates[m.media].rtp) {
            // Already collected candidates from a different m-line
            return;
        }
        
        candidates[m.media] = {};       
        
        m.a.forEach(function (a) {
            switch (a.field) {
            case 'ice-ufrag':
                candidates[m.media].ufrag = a.value;
                break;

            case 'ice-pwd':
                candidates[m.media].pwd = a.value;
                break;

            case 'candidate':
                var candidate = new IceCandidate();
                candidate.parse(a.value);
                
                var name = (candidate.componentId === 1) ? 'rtp' : 'rtcp';
    
                if (!candidates[m.media][name]) {
                    candidates[m.media][name] = [ candidate ];
                } else {
                    // Put highest priority candidate in 1st position
                    if (candidate.priority > candidates[m.media][name][0].priority) {
                        candidates[m.media][name].unshift(candidate);
                    } else {
                        candidates[m.media][name].push(candidate);
                    }
                }
                break;
            }
        });
        
        if (ufrag && !candidates[m.media].ufrag) {
            candidates[m.media].ufrag = ufrag;
        }
    
        if (pwd && !candidates[m.media].pwd) {
            candidates[m.media].pwd = pwd;
        }

        if (!candidates[m.media].ufrag || !candidates[m.media].pwd) {
            logWarning('Missing ufrag or pwd for ' + m.media);
            delete candidates[m.media];
        }

    });
    return candidates;
}
exports.getCandidates = getCandidates;


function getSdesDataForMediaDescripton(m) {
    if (!m) { return null; }

    if (m.media !== 'audio' && m.media !== 'video') {
        return null;
    }
    if (m.proto !== 'RTP/SAVP' && m.proto !== 'RTP/SAVPF') {
        return null;
    }
    
    var sdes = null, ssrcId = null;      
    
    m.a.forEach(function (a) {
        switch (a.field) {
        case 'crypto':
            var parsedSdes = new SdesData(a.value);
            if (parsedSdes.cryptoSuite === 'AES_CM_128_HMAC_SHA1_80') {
                sdes = parsedSdes;
            }
            break;

        case 'ssrc':
            var tmp = /^(\d+) /.exec(a.value);
            ssrcId = tmp && tmp[1];
            break;
        }            
    });

    if (sdes && ssrcId) {
        sdes.ssrc = parseInt(ssrcId, 10);
    }
    return sdes;
}


function getSdesData(parsedSdp) {
    var sdes = {audio: null, video: null};        
    parsedSdp.m.forEach(function (m) {
        // The following check must be for '=== null'. Do not change it.
        if (sdes[m.media] === null) {
            sdes[m.media] = getSdesDataForMediaDescripton(m);
        }
    });
    return sdes;
}
exports.getSdesData = getSdesData;


/*
 * This function returns an object as follows
 * address: 
 * audio: {idx:, port:, sdes:}
 * video: {idx:, port:, sdes:}
 * mLines : []
 */
function getConnections(sdp) {
    var parsedSdp = (typeof(sdp) === 'string') ? sdpParser.parse(sdp) : sdp; 

    var conn = {
        address: null,
        audio: null,
        video: null,
        mLines: []
    };
    
    if (!parsedSdp.c) {
        throw new Error('SDP is missing c-line at session level');
    }

    conn.address = parsedSdp.c.address;
    
    for (var idx = 0; idx < parsedSdp.m.length; idx++) {
        var m = parsedSdp.m[idx];
        conn.mLines.push({
            media: m.media,
            port: 0,
            proto: m.proto,
            fmt: m.fmt.slice(0, 1)
        });
        
        if ((m.port === 0) ||
            (m.media !== 'audio' && m.media !== 'video') ||
            (m.proto === 'RTP/SAVP' && !isSdes(m))) {
            continue;
        }
        
        if (conn[m.media] && conn[m.media].sdes) {
            // Already found the RTP/SAVP m-line
            continue;
        }
        conn[m.media] = {
            idx: idx,
            port: m.port,
            sdes: getSdesDataForMediaDescripton(m)
        };

        if (m.c) {
            conn[m.media].address = m.c.address;
        }

        // Validate the connection before returning
        if (!conn.address && !conn[m.media].address) {
            logError('No address for ' + m.media + ' media description');
            conn[m.media] = null;
        }
    }
    return conn;
}
exports.getConnections = getConnections;


// For some obscure reason, Google has hardcoded some dynamic payload types in Chrome. 
// The function below is responsible to remove any conflicting codecs from the given media description.
var chromeCodecs = [98, 99];
var codecsData = [
    {pt: 98, name: 'CN', clock: 16000},
    {pt: 99, name: 'CN', clock: 32000}
];

function filterReservedCodecs(m) {
    if (m.media !== 'audio') { return; }

    var tmp, codec, idx;
    var codecsToRemove = [];
    
    m.a = m.a.filter(function (a) {
        if (a.field !== 'rtpmap') { 
            return true; 
        }

        // Parse the rtpmap attribute
        // a=rtpmap:<payload type> <encoding name>/<clock rate> [/<encoding parameters>]
        tmp = /^(\d+)\s+(\S+)\/(\d+)/.exec(a.value);
        codec = {
            pt: parseInt(tmp[1], 10),
            name: tmp[2],
            clock: parseInt(tmp[3], 10)
        };
        if (codec.pt < 96) {
            // Payload Type is not dynamic
            return true;
        }
        idx = chromeCodecs.indexOf(codec.pt);
        if (idx === -1) {
            return true;
        }
        if ((codec.name !== codecsData[idx].name) || (codec.clock !== codecsData[idx].clock)) {
            codecsToRemove.push(codec.pt);
            logDebug('Remove received codec: ' + common.inspect(codec) + 
                '\r\nConflicting codec in Chrome: ' + common.inspect(codecsData[idx]));
            return false;
        }
        // Codec is safe
        return true;
    });

    if (codecsToRemove.length === 0) { 
        logDebug('All received audio codecs are OK');
        return; 
    }

    // Remove codecs from m-line
    m.fmt = m.fmt.filter(function (pt) { return codecsToRemove.indexOf(pt) === -1; });

    // Remove associated fmtp attributes
    var fmt;
    m.a = m.a.filter(function (a) {
        if (a.field !== 'fmtp') { return true; }

        // Parse the fmtp attribute and check if format matches one of the codecs to be removed
        // a=fmtp:<format> <format specific parameters
        tmp = /^(\d+)\s/.exec(a.value);
        fmt = parseInt(tmp[1], 10);
        return (codecsToRemove.indexOf(fmt) === -1);
    });
}


function buildWebRtcSdp(inputSdp, conn, candidates, sdes, ssrc) {
    assert.ok(inputSdp);
    assert.ok(conn && conn.audio);
    assert.ok(candidates && candidates.audio && candidates.audio.rtp && candidates.audio.rtcp);
    
    function modifyMediaDescription(m) {
        filterReservedCodecs(m);

        m.port = candidates[m.media].rtp.port;
        m.proto = 'RTP/SAVPF';
        // Add c-line to media description (This is what Chrome does...)
        m.c = {nettype: 'IN', addrtype: 'IP4', address: candidates[m.media].rtp.address};   
        
        if (sdes && sdes[m.media]) {
            // Remove any existing crypto attributes and add the new one
            m.a = m.a.filter(function (a) { return (a.field !== 'crypto'); });
            m.a.push(sdes[m.media].getParsedAttribute());
        }

        // Add candidates
        m.a.unshift(candidates[m.media].rtp.getParsedAttribute(), candidates[m.media].rtcp.getParsedAttribute());
        
        // Add rtcp attribute
        var rtcpAttr = {
            field: 'rtcp', 
            value: [candidates[m.media].rtcp.port, 'IN', 'IP4', candidates[m.media].rtcp.address].join(' ')
        };  
        m.a.unshift(rtcpAttr);      

        // Add the ice parameters at the top
        m.a.unshift({field: 'ice-pwd', value: candidates[m.media].pwd});        
        m.a.unshift({field: 'ice-ufrag', value: candidates[m.media].ufrag});        

        // Add ssrc parameters at the bottom
        if (ssrc && ssrc[m.media]) {            
            m.a.push({field: 'ssrc', value: ssrc[m.media].id + ' cname:' + ssrc[m.media].cname});
            m.a.push({field: 'ssrc', value: ssrc[m.media].id + ' mslabel:' + ssrc[m.media].mslabel});
            m.a.push({field: 'ssrc', value: ssrc[m.media].id + ' label:' + ssrc[m.media].label});
        }

        // Add mid parameter at the bottom
        m.a.push({field: 'mid', value: m.media});
    }
    
    if (conn.video) {
        assert.ok(candidates.video && candidates.video.rtp && candidates.video.rtcp);
    }

    var parsedSdp = (typeof(inputSdp) === 'string') ? sdpParser.parse(inputSdp) : inputSdp; 

    // Remove c-line from session level
    delete parsedSdp.c;
    
    // Modify audio m-line
    var audio = parsedSdp.m[conn.audio.idx];
    modifyMediaDescription(audio);

    parsedSdp.a = []; // TODO: Do we need to keep any session level attributes?

    // Modify video m-line
    var video = null;
    if (conn.video) {
        video = parsedSdp.m[conn.video.idx];
        modifyMediaDescription(video);
    }

    parsedSdp.m = [ audio ];
    if (video) {
        parsedSdp.m.push(video);
    }
    return sdpParser.stringify(parsedSdp);
}
exports.buildWebRtcSdp = buildWebRtcSdp;


// The input to this function must be the parsed WebRTC SDP object (see parseWebRtcSdp function)
// [PC] The removeSrtp parameter has been added for the PeerConnection project 
// to allow removing the secure m-line (RTP/SAVP) from the generated offer. This is 
// used to force the SRTP<->RTP<->SRTP interworking in the RTPProxy.
function buildSipSdpOffer(parsedSdp, address, audioPort, videoPort, removeSrtp) {
    assert.ok(parsedSdp);
    assert.ok(address);
    assert.ok(audioPort);

    parsedSdp.o.id = parsedSdp.o.version = common.rstring();
    
    // Set the connection information
    parsedSdp.c = {
        nettype: 'IN',
        addrtype: 'IP4',
        address: address
    };
    
    var mediaDescriptions = []; 
    parsedSdp.m.forEach(function (m) {
        // Set the port
        if (m.media === 'audio') {
            m.port = +audioPort;
        } else if (m.media === 'video') {
            m.port = +videoPort;
        }
        
        // [PC] Do not add RTP/SAVP m-line if removeSrtp is true
        if (!removeSrtp) {
            mediaDescriptions.push(m);
        }
        if (m.media === 'audio' || m.media === 'video') {
            // Add an additional m-line for RTP/AVP
            var avp = {
                media: m.media,
                port: m.port,
                portnum: m.portnum,
                fmt: m.fmt,
                a: []
            };
            m.a.forEach(function (a) {
                switch (a.field) {
                case 'rtpmap':
                case 'fmtp':
                case 'sendrecv':
                case 'sendonly':
                case 'recvonly':
                case 'inactive':
                    avp.a.push(a);
                    break;
                }
            });

            mediaDescriptions.push(avp);
        }
    });
    parsedSdp.m = mediaDescriptions;
    
    return sdpParser.stringify(parsedSdp);
}
exports.buildSipSdpOffer = buildSipSdpOffer;


function buildSipSdpAnswer(parsedSdp, conn) {
    assert.ok(parsedSdp);
    assert.ok(conn);

    function updateAttributes(m) {
        m.a = m.a.filter(function (a) {
            switch (a.field) {
            case 'candidate':
            case 'ice-ufrag':
            case 'ice-pwd':
            case 'ice-options':
                return false;
                
            case 'crypto':
            case 'ssrc':
                if (m.proto !== 'RTP/SAVP') {
                    return false;
                }
                break;
            }
            return true;
        });
    }

    parsedSdp.o.id = parsedSdp.o.version = common.rstring();

    // Update the c-line
    parsedSdp.c = {
        nettype: 'IN',
        addrType: 'IP4',
        address: conn.address
    };
    
    // Update the m-lines
    var mLines = conn.mLines;
    
    var audio = parsedSdp.m[0];
    audio.port = conn.audio.port;
    audio.proto = mLines[conn.audio.idx].proto;
    updateAttributes(audio);
    mLines[conn.audio.idx] = audio;
    
    if (parsedSdp.m[1] && conn.video && conn.video.port > 0) {
        var video = parsedSdp.m[1];
        video.port = conn.video.port;
        video.proto = mLines[conn.video.idx].proto;
        updateAttributes(video);
        mLines[conn.video.idx] = video;     
    }
    parsedSdp.m = mLines;

    return sdpParser.stringify(parsedSdp);
}
exports.buildSipSdpAnswer = buildSipSdpAnswer;


function restoreWebRtcSdp(inputSdp) {
    var parsedSdp = (typeof(inputSdp) === 'string') ? sdpParser.parse(inputSdp) : inputSdp; 

    // Remove the c-line at the session level
    delete parsedSdp.c;
    
    var candidates = getCandidates(parsedSdp);
    logDebug('ICE Candidates:' + common.inspect(candidates));
    
    var hasVideo = false;
    parsedSdp.m = parsedSdp.m.filter(function (m) {
        switch (m.media) {
        case 'audio':
            if (m.proto === 'RTP/AVP') {
                return false;
            }
            restoreWebRtcMediaDescription(m, (candidates && candidates.audio));
            break;

        case 'video':
            if (m.proto === 'RTP/AVP') {
                return false;
            }
            hasVideo = true;
            restoreWebRtcMediaDescription(m, (candidates && candidates.video));
            break;
        }
        return true;
    });
    
    return sdpParser.stringify(parsedSdp);
}
exports.restoreWebRtcSdp = restoreWebRtcSdp;


function restoreWebRtcMediaDescription(m, candidates) {
    var rtpPort = (candidates && candidates.rtp) ? candidates.rtp[0].port : 1;
    var rtpAddress = (candidates && candidates.rtp) ? candidates.rtp[0].address : '0.0.0.0';
    var rtcpPort = (candidates && candidates.rtcp) ? candidates.rtcp[0].port : 1;
    var rtcpAddress = (candidates && candidates.rtcp) ? candidates.rtcp[0].address : '0.0.0.0';

    m.port = rtpPort;
    m.proto = 'RTP/SAVPF';
    // Add c-line to media description
    m.c = {nettype: 'IN', addrtype: 'IP4', address: rtpAddress};    
    
    // Add rtcp, rtcp-mux and mid attributes
    m.a.unshift({
        field: 'rtcp', 
        value: [rtcpPort, 'IN', 'IP4', rtcpAddress].join(' ')
    });
    m.a.unshift({field: 'rtcp-mux'});
    m.a.push({field: 'mid', value: m.media});
}



/*
 * IceCandidate Object
 */
function IceCandidate(rtp, address, port) {
    /*******************
    // candidate-attribute   = "candidate" ":" foundation SP component-id SP
    //                         transport SP
    //                         priority SP
    //                         connection-address SP     ;from RFC 4566
    //                         port         ;port from RFC 4566
    //                         SP cand-type
    //                         [SP rel-addr]
    //                         [SP rel-port]
    //                         *(SP extension-att-name SP
    //                         extension-att-value)
    //
    // foundation            = 1*32ice-char
    // component-id          = 1*5DIGIT
    // transport             = "UDP" / transport-extension
    // transport-extension   = token              ; from RFC 3261
    // priority              = 1*10DIGIT
    // cand-type             = "typ" SP candidate-types
    // candidate-types       = "host" / "srflx" / "prflx" / "relay" / token
    // rel-addr              = "raddr" SP connection-address
    // rel-port              = "rport" SP port
    // extension-att-name    = byte-string    ;from RFC 4566
    // extension-att-value   = byte-string
    // ice-char              = ALPHA / DIGIT / "+" / "/"
     *******************/

    this.foundation = 1;
    this.componentId = rtp ? 1 : 2; 
    this.transport = 'udp';
    this.priority = 1;
    this.address = address || '0.0.0.0';
    this.port = port || 1;
    this.typ = 'host';
    this.generation = 0;

    this.optional = ['generation'];
}
exports.IceCandidate = IceCandidate;

IceCandidate.prototype.isRtp = function () {
    return (this.componentId === 1);
};

IceCandidate.prototype.isRtcp = function () {
    return (this.componentId === 2);
};

IceCandidate.prototype.parse = function (candidate) {
    if (candidate.indexOf('a=candidate:') === 0) {
        candidate = candidate.substring(12);
    }
    
    var tmp = candidate.split(SP);
    if (tmp.length < 7) {
        throw new Error('Invalid candidate: ' + candidate);
    }
    this.foundation = Number(tmp[0]);
    this.componentId = Number(tmp[1]); 
    this.transport = tmp[2];
    this.priority = Number(tmp[3]);
    this.address = tmp[4];
    this.port = tmp[5];
    this.typ = tmp[7];

    for (var idx = 8; idx < tmp.length; idx += 2) {
        this.optional.push(tmp[idx]);
        this[tmp[idx]] = tmp[idx + 1];
    }
};

IceCandidate.prototype.getValue = function () {
    var str = this.foundation + SP + this.componentId + SP + this.transport +
        SP + this.priority + SP + this.address + SP + this.port + SP + 'typ ' + this.typ;
    
    for (var idx = 0; idx < this.optional.length; idx++) {
        var param = this.optional[idx];
        str += SP + param + SP + this[param];
    }   
    return str;
};

IceCandidate.prototype.getParsedAttribute = function () {
    return {
        field: 'candidate',
        value: this.getValue()
    };
};

IceCandidate.prototype.toString = function () {
    var str = 'candidate:' + this.getValue();
    return str;
};



/*
 * SDES Crypto Data
 */
function SdesData(cryptoValue) {
    /*******************
    // "a=crypto:" tag 1*WSP srtp-crypto-suite 1*WSP key-params
    //                                         *(1*WSP srtp-session-param)
    //
    //    key-params       = key-param *(";" key-param)
    //    key-param        = srtp-key-method ":" srtp-key-info
    //    
    //    srtp-crypto-suite   = "AES_CM_128_HMAC_SHA1_32" /
    //                          "F8_128_HMAC_SHA1_32" /
    //                          "AES_CM_128_HMAC_SHA1_80" /
    //                          srtp-crypto-suite-ext
    //    
    //    srtp-key-method     = "inline"
    //    srtp-key-info       = key-salt ["|" lifetime] ["|" mki]
    //    
    //    key-salt            = 1*(base64)   ; binary key and salt values
    //                                       ; concatenated together, and then
    //                                       ; base64 encoded [section 3 of
    //                                       ; RFC3548
    //    
    //    lifetime           = ["2^"] 1*(DIGIT)   ; see section 6.1 for "2^"
    //    mki                 = mki-value ":" mki-length
    //    mki-value           = 1*DIGIT
    //    mki-length          = 1*3DIGIT   ; range 1..128.
    //    
     *******************/

    if (cryptoValue) {
        var tmp = /^(\d+)\s+(\S+)\s+inline:(\S+)/.exec(cryptoValue);
        this.tag = parseInt(tmp[1], 10);
        this.cryptoSuite = tmp[2];
        this.keySalt = new Buffer(tmp[3], 'base64');        
    } else {
        this.tag = 0;
        this.cryptoSuite = 'AES_CM_128_HMAC_SHA1_80';
        this.keySalt = new Buffer(common.genRandomString(30), 'ascii');        
    }
    this.ssrc = 0;
}
exports.SdesData = SdesData;

SdesData.prototype.getValue = function () {
    var str = this.tag + ' ' + this.cryptoSuite + ' ' + 'inline:' + this.keySalt.toString('base64');
    return str;
};

SdesData.prototype.getParsedAttribute = function () {
    return {
        field: 'crypto',
        value: this.getValue()
    };
};

SdesData.prototype.toString = function () {
    var str = 'crypto:' + this.getValue();
    return str;
};

