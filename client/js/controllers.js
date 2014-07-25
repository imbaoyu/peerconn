// Define global variables for JSHint
/*global alert, angular, AppMode, console, document, navigator, window, mozRTCPeerConnection, webkitRTCPeerConnection, 
webkitURL, WsConnectionState, RTCIceCandidate, RTCSessionDescription, sdpParser*/


(function () {
    'use strict';

    // for node-webkit
    var requireNode = window.require;

    var CallStatus = Object.freeze({
        Initiating: 'Initiating',
        Calling: 'Calling',
        Incoming: 'Incoming',
        Alerting: 'Alerting',
        Answering: 'Answering',
        Established: 'Established'
    });

    var SdpStatus = Object.freeze({
        OfferSent: 'Offer-Sent',
        OfferReceived: 'Offer-Received',
        OfferPending: 'Offer-Pending',
        AnswerPending: 'Answer-Pending',
        PrAnswerSent: 'PrAnswer-Sent',
        PrAnswerReceived: 'PrAnswer-Received',
        Established: 'Established'
    });


    /* Controllers */
    angular.module('myApp').controller('AppCtrl', ['$scope', '$window', '$timeout', '$filter', 'Socket', 'Environment', function ($scope, $window, $timeout, $filter, Socket, Environment) {
        var MAX_LOG_ENTRIES = 150;

        var pc = null;
        var localStreams = [];
        var mediaConstraints = {audio: true, video: true};

        var statCollector = null;
        var signinTimeout = null;

        var localVideo = document.getElementById('localVideo');
        var remoteVideo = document.getElementById('remoteVideo');
        var voice = document.getElementById('voice'); // Used for Firefox
        var audioRing = document.getElementById('audioRing');

        var RTCPeerConnection;
        var SessionDescription;

        $scope.isFirefox = (navigator.userAgent.indexOf("Firefox") !== -1);
        if ($scope.isFirefox) {
            RTCPeerConnection = mozRTCPeerConnection;
            SessionDescription = function (sdp) {
                this.type = sdp.type;
                this.sdp = sdp.sdp;
            };
        } else {
            RTCPeerConnection = webkitRTCPeerConnection;
            SessionDescription = RTCSessionDescription;
        }

        $scope.autoAnswer = true;
        $scope.reusePC = false;
        $scope.enableChime = true;

        // Firefox doesn't support provisional SDP answers 
        $scope.sendPrAnswer = !$scope.isFirefox;

        // Firefox doesn't support trickle ICE at the moment. 
        // However, the trickleIce... variables MUST be set to true so we don't wait for the candidates.
        $scope.trickleIceForOffer = true;
        $scope.trickleIceForAnswer = true;

        $scope.useDTLS = false;

        $scope.useRtpProxy = false;
        $scope.srtpInterwork = false;

        $scope.isSignedIn = false;
        $scope.callStatus = null;
        $scope.sdpStatus = null;
        $scope.isMuted = false;
        $scope.readyState = null;
        $scope.iceState = null;
        $scope.peers = [];
        $scope.activePeer = null;
        $scope.audioStats = '';
        $scope.videoStats = '';
        $scope.hasLocalVideo = false;
        $scope.hasRemoteVideo = false;


        /////////////////////////////////////////////////////////////////////////////
        // AppCache handling
        /////////////////////////////////////////////////////////////////////////////
        var appCache = window.applicationCache;

        $scope.appCacheStatus = function () {
            switch (appCache.status) {
            case appCache.UNCACHED: // UNCACHED == 0
                return 'UNCACHED';
            case appCache.IDLE: // IDLE == 1
                return 'IDLE';
            case appCache.CHECKING: // CHECKING == 2
                return 'CHECKING';
            case appCache.DOWNLOADING: // DOWNLOADING == 3
                return 'DOWNLOADING';
            case appCache.UPDATEREADY:  // UPDATEREADY == 4
                return 'UPDATEREADY';
            case appCache.OBSOLETE: // OBSOLETE == 5
                return 'OBSOLETE';
            default:
                return 'UKNOWN CACHE STATUS';
            }
        };

        function handleCacheEvent() {
            $scope.$apply();
        }

        function handleCacheError() {
            console.log('Error: Cache failed to update!');
        }

        // Fired after the first cache of the manifest.
        appCache.addEventListener('cached', handleCacheEvent, false);

        // Checking for an update. Always the first event fired in the sequence.
        appCache.addEventListener('checking', handleCacheEvent, false);

        // An update was found. The browser is fetching resources.
        appCache.addEventListener('downloading', handleCacheEvent, false);

        // The manifest returns 404 or 410, the download failed,
        // or the manifest changed while the download was in progress.
        appCache.addEventListener('error', handleCacheError, false);

        // Fired after the first download of the manifest.
        appCache.addEventListener('noupdate', handleCacheEvent, false);

        // Fired if the manifest file returns a 404 or 410.
        // This results in the application cache being deleted.
        appCache.addEventListener('obsolete', handleCacheEvent, false);

        // Fired for each resource listed in the manifest as it is being fetched.
        appCache.addEventListener('progress', handleCacheEvent, false);

        // Fired when the manifest resources have been newly redownloaded.
        appCache.addEventListener('updateready', handleCacheEvent, false);


        /////////////////////////////////////////////////////////////////////////////
        // Internal functions
        /////////////////////////////////////////////////////////////////////////////
        function signin() {
            try {
                // Make sure that we don't have any stale Local Streams
                stopLocalStreams();

                if ($scope.isFirefox) {
                    getUserMediaForFirefox(function () {
                        sendSignin('firefox');
                    }, onFailure);
                } else {
                    getUserMediaForChrome(function () {
                        sendSignin('chrome');
                    }, onFailure);
                }

            } catch (e) {
                logError('GetUserMedia exception: ', e);
                alert('GetUserMedia() failed. You need the latest Chrome or Firefox Nightly');
            }
            log('Requested access to local media');


            function onFailure(error) {
                stopLocalStreams();

                var errorMsg = error;
                if (error.code) {
                    if (error.code === error.PERMISSION_DENIED) {
                        errorMsg = 'PERMISSION_DENIED';
                    } else {
                        errorMsg = 'Error Code: ' + error.code;
                    }
                }
                alert('Failed to get access to local media (' + errorMsg + ')');
            }
        }

        /////////////////////////////////////////////////////////////////////////////
        // Scope functions
        /////////////////////////////////////////////////////////////////////////////
        $scope.signin = function () {
            if ($scope.connectionState === WsConnectionState.Connected) {
                signin();
            } else {
                Socket.connect($scope.wshost, function (err) {
                    if (err) {
                        log(err);
                    } else {
                        signin();
                    }
                });
            }
        };


        $scope.signout = function () {
            if ($scope.isSignedIn) {
                if ($scope.callStatus) {
                    $scope.hangup();
                }
                sendMessage('wsSignout', {user: $scope.username});
                stopLocalStreams();
                $scope.isSignedIn = false;
            }
        };


        $scope.call = function (peer, event) {
            try {
                event.stopPropagation();

                if (!$scope.isSignedIn || !createPeerConnection()) {
                    return;
                }

                $scope.activePeer = peer.user;
                setCallStatus(CallStatus.Initiating);

                addLocalStreams();

                mediaConstraints = {audio: true, video: true};

                var constraints = {
                    mandatory: {
                        'OfferToReceiveAudio': mediaConstraints.audio, 
                        'OfferToReceiveVideo': mediaConstraints.video
                    }
                };

                if ($scope.isFirefox){
                    constraints.mandatory.MozDontOfferDataChannel = true;
                }

                log('constraints: ' + angular.toJson(constraints,true));

                log('Creating Local Description...');
                pc.createOffer(setLocalAndSendMessage, function (error) {
                    log('Failed to create Local Description: ' + error);
                    stopCall();
                }, constraints);
            } catch (e) {
                logError('Exception in call(): ', e);
                stopCall();
            }
        };


        $scope.answer = function () {
            audioRing.pause();
            setCallStatus(CallStatus.Answering);
            createAndSendAnswer();
        };


        $scope.hangup = function () {
            if ($scope.isAlerting()) {
                disconnect(603, 'Decline');
            } else {
                disconnect(200, 'Normal Clearing');
            }
        };


        $scope.mute = function () {
            enableAudio(false);
            $scope.isMuted = true;
        };


        $scope.unmute = function () {
            enableAudio(true);
            $scope.isMuted = false;
        };


        $scope.addVideo = function () {
            log('Add Video Stream');
            mediaConstraints = {audio: true, video: true};
            renegotiateMedia();
        };


        $scope.removeVideo = function () {
            log('Remove Video Stream');
            mediaConstraints = {audio: true, video: false};
            renegotiateMedia();
        };

        $scope.hasVideo = function () {
            return mediaConstraints.video;
        };

        $scope.logPeerConnection = function () {
            if (pc) {
                log('RTCPeerConnection: ' + angular.toJson(pc, true));
            }
        };


        $scope.localStreamData = function () {
            if ($scope.isFirefox) {
                return 'not supported';
            }

            if (!pc){
                return '<none>';
            }

            var pcStreams = pc.localStreams || pc.getLocalStreams();
            if (pcStreams.length === 0) {
                return '<none>';
            }

            var data = '';
            for (var idx = 0; idx < pcStreams.length; idx++) {      
                data += (idx > 0) ? ',[' : '[';
                data += getMediaStreamData(pcStreams[idx]);
                data += ']';
            }
            return data;
        };


        $scope.logLocalStreams = function () {

            if (!pc){
                return;
            }
            var pcStreams = pc.localStreams || pc.getLocalStreams();
            if (pcStreams) {
                log('RTCPeerConnection.localStreams: ' + angular.toJson(pcStreams, true));
            }
        };


        $scope.remoteStreamData = function () {
            if ($scope.isFirefox) {
                return 'not supported';
            }

            if (!pc){
                return '<none>';
            }

            var pcStreams = pc.localStreams || pc.getLocalStreams();
            if (!pcStreams || pcStreams.length === 0) {
                return '<none>';
            }

            var data = '';
            for (var idx = 0; idx < pcStreams.length; idx++) {      
                data += (idx > 0) ? ',[' : '[';
                data += getMediaStreamData(pcStreams[idx]);
                data += ']';
            }
            return data;
        };


        $scope.logRemoteStreams = function () {
            if (pc && pc.remoteStreams) {
                log('RTCPeerConnection.remoteStreams: ' + angular.toJson(pc.remoteStreams, true));
            }
        };


        $scope.hasActiveCall = function () {
            var activeCall = ($scope.isSignedIn && 
                $scope.callStatus === CallStatus.Established &&
                $scope.sdpStatus === SdpStatus.Established);

            return activeCall;
        };


        $scope.isAlerting = function () {
            return ($scope.callStatus === CallStatus.Alerting);
        };


        // http://coderwall.com/p/ngisma
        $scope.safeApply = function (fn) {
            var phase = this.$root.$$phase;
            if (phase === '$apply' || phase === '$digest') {
                fn();
            } else {
                this.$apply(fn);
            }
        };


        // Temporary expose in scope until moved to a service
        $scope.log = function (s) {
            log(s);
        };


        /////////////////////////////////////////////////////////////////////////////
        // Socket listeners
        /////////////////////////////////////////////////////////////////////////////
        Socket.on('wsSigninAck', function () {
            log('S->C [wsSignInAck]');
            $scope.isSignedIn = true;
            window.clearTimeout(signinTimeout);
            signinTimeout = null;
            log('Successfully logged in as: ' + $scope.username);

            Environment.store('user', $scope.username);
        });


        Socket.on('wsSigninNack', function (data) {
            log('S->C [wsSignInNack]:\n' + angular.toJson(data, true));
            stopLocalStreams();
            alert(data.error);
        });


        Socket.on('wsPeerList', function (data) {
            log('S->C [wsPeerList]:\n' + angular.toJson(data, true));
            $scope.peers = [];
            data.forEach(function (peer) {
                if (peer.user !== $scope.username) {
                    $scope.peers.push(peer);
                }
            });
        });

        function handleWsOffer(data) {
            log('S->C [wsOffer]:\n' + angular.toJson(data, true));

            if (!$scope.callStatus) {
                // This is a new call
                $scope.activePeer = data.peer;
                setCallStatus(CallStatus.Incoming);
            }

            if (!createPeerConnection()) {
                disconnect(488, 'RTCPeerConnection Not Supported');
            } else {
                setRemoteDescription(data.sdp);
            }
        }
        Socket.on('wsOffer', handleWsOffer);

        Socket.on('wsAnswer', function (data) {
            log('S->C [wsAnswer]:\n' + angular.toJson(data, true));
            if (!$scope.callStatus || $scope.callStatus === CallStatus.Initiating) {
                sendDisconnect(481, 'No Active Conversation');
            } else {
                setRemoteDescription(data.sdp);
            }
        });


        Socket.on('wsCandidate', function (data) {
            log('S->C [wsCandidate]:\n' + angular.toJson(data, true));
            if (!$scope.callStatus || $scope.callStatus === CallStatus.Initiating) {
                sendDisconnect(481, 'No Active Conversation');
            } else if ($scope.isFirefox) {
                disconnect(488, 'Trickle ICE is Not Supported');
            } else {
                pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        });


        Socket.on('wsDisconnect', function (data) {
            log('S->C [wsDisconnect]:\n' + angular.toJson(data, true));
            if ($scope.callStatus) {
                stopCall();
                if (data.status !== 200) {
                    alert(data.reason);
                }
            }
        });


        Socket.on('disconnect', function () {
            log('Socket has disconnected');
            if ($scope.isSignedIn) {
                stopCall();
                stopLocalStreams();
                $scope.isSignedIn = false;
            }
        });

        Socket.on('connectionStateChange', function (data) {
            log('Socket connection state changed to ' + data.state);
            $scope.connectionState = data.state;

            if (data.state === WsConnectionState.Connected) {
                Environment.store('host', data.host);
            }
        });

        // Miss-use Socket a bit since this is not really a socket event
        Socket.on('resumed', function (data) {
            log('Chrome App has resumed');
            $scope.username = data.user.user;
            $scope.signin();

            if (data.accept) {
                // Ugly, but will do it for now
                handleWsOffer(data.originalMsg.data);
                $timeout(function () {
                    $scope.answer();
                }, 1000);
            }
        });


        /////////////////////////////////////////////////////////////////////////////
        // RTCPeerConnection Creation and Event Handlers
        /////////////////////////////////////////////////////////////////////////////
        function createPeerConnection() {
            //var pc_config = null;
            //var pc_config = {"iceServers": [{"url": "stun:stun.l.google.com:19302"}]};
            //var pc_constraints = null;

            var pc_config = {"iceServers": [{"url": "stun:stun.l.google.com:19302"}, {"url": "turn:54.200.59.129:443?transport=tcp", "credential":"hero","username":"gorst"}]};
            var pc_constraints = {"optional":[{"DtlsSrtpKeyAgreement":true}]};

            // http://www.webrtc.org/interop
            // Chrome does not yet do DTLS-SRTP by default whereas Firefox only does DTLS-SRTP. In order to get interop, 
            // you must supply Chrome with a PC constructor constraint to enable DTLS:
            // { 'mandatory': [{'DtlsSrtpKeyAgreement': 'true'}]}
            // Firefox does not yet accept DNS names for STUN servers. Only IP addresses area permitted. E.g.,
            // { "iceServers": [ { url:"stun:23.21.150.121" } ]}
            // Finally, Firefox offers a data channel on every offer by default (this is a stopgap till the data channel APIs are complete). 
            // Chrome mishandles the data channel m-line. In order to suppress the Firefox data channel offer, 
            // you need to supply a mandatory constraint to Firefox on CreateOffer. E.g.,
            // {'mandatory': {'MozDontOfferDataChannel':true}}

            if (!$scope.isFirefox && $scope.useDTLS){
                pc_constraints = {"optional": [{"DtlsSrtpKeyAgreement": true}]};
            }

            log('pc_config: ' + angular.toJson(pc_config));
            log('pc_constraints: ' + angular.toJson(pc_constraints));

            try {
                if (pc) {
                    if ($scope.reusePC) {
                        return true;
                    } else {
                        log('Close the old RTCPeerConnection');
                        clearRemoteMedia();
                        unregisterEvtHandlers(pc);
                        pc.close();
                        pc = null;
                    }
                }
                pc = new RTCPeerConnection(pc_config,pc_constraints);
                log('Created RTCPeerConnection: ' + angular.toJson(pc, true));
                
                registerEvtHandlers(pc);
                $scope.readyState = pc.readyState;
                $scope.iceState = pc.iceState;

            } catch (e) {
                pc = null;
                logError('Failed to create PeerConnection. ', e);
                alert('Cannot create PeerConnection object. You need the latest Chrome or Firefox Nightly.');
                return false;
            }
            return true;
        }


        function registerEvtHandlers(_pc) {
            _pc.onaddstream = onRemoteStreamAdded;
            _pc.onremovestream = onRemoteStreamRemoved;
            _pc.onicecandidate = onIceCandidate;
            _pc.onicechange = onIceChange;
            _pc.onstatechange = onStateChange;
            _pc.ongatheringchange = onGatheringChange;
            if (!$scope.isFirefox) {
                _pc.onopen = onOpen;
                _pc.onconnecting = onConnecting;
                _pc.onnegotiationneeded = onNegotiationNeeded;
            }
        }


        function unregisterEvtHandlers(_pc) {
            _pc.onaddstream = null;
            _pc.onremovestream = null;
            _pc.onicecandidate = null;
            _pc.onicechange = null;
            _pc.onstatechange = null;
            _pc.ongatheringchange = null;
            if (!$scope.isFirefox) {
                _pc.onopen = null;
                _pc.onconnecting = null;
                _pc.onnegotiationneeded = null;
            }
        }


        function onGatheringChange(/*event*/) {
            $scope.safeApply(function () {
                $scope.iceGatheringState = pc && pc.iceGatheringState;
                log('RTCPeerConnection - ongatheringchange: ' + $scope.iceGatheringState);

                if ($scope.iceGatheringState === 'complete'){
                    if ($scope.sdpStatus === SdpStatus.OfferPending) {
                        sendOffer(pc.localDescription);
                    } else if ($scope.sdpStatus === SdpStatus.AnswerPending) {
                        sendAnswer(pc.localDescription);
                    }
                }

            });
        }


        function onIceCandidate(event) {
            $scope.safeApply(function () {
                if (event.candidate) {
                    if (($scope.sdpStatus !== SdpStatus.PrAnswerSent) &&
                        ($scope.sdpStatus !== SdpStatus.OfferPending) &&
                        ($scope.sdpStatus !== SdpStatus.AnswerPending)) {
                        sendMessage('wsCandidate', {candidate: event.candidate});
                    } else {
                        log('New ICE candidate: ' + angular.toJson(event.candidate, true));
                    }
                } else {
                    log('End of candidates');

                    if ($scope.sdpStatus === SdpStatus.OfferPending) {
                        sendOffer(pc.localDescription);
                    } else if ($scope.sdpStatus === SdpStatus.AnswerPending) {
                        sendAnswer(pc.localDescription);
                    }
                }
            });
        }


        function onStateChange(/*event*/) {
            $scope.safeApply(function () {
                $scope.readyState = pc && pc.readyState;
                log('RTCPeerConnection - onstatechange: ' + $scope.readyState);
            });
        }


        function onIceChange(/*event*/) {
            $scope.safeApply(function () {
                $scope.iceState = pc && pc.iceState;
                log('RTCPeerConnection - onicechange: ' + $scope.iceState);
            });
        }


        function onNegotiationNeeded(/*event*/) {
            $scope.safeApply(function () {
                log('RTCPeerConnection - onnegotiationneeded');
            });
        }


        function onConnecting(/*event*/) {
            $scope.safeApply(function () {
                log('RTCPeerConnection - onconnecting');
            });
        }


        function onOpen(/*event*/) {
            $scope.safeApply(function () {
                log('RTCPeerConnection - onopen');
            });
        }


        function onRemoteStreamAdded(event) {
            $scope.safeApply(function () {
                log('RTCPeerConnection - onaddstream');
                log('Added Remote Stream: ' + angular.toJson(event.stream, true));

                if ($scope.isFirefox) {
                    // Firefox 
                    log('Added Stream Type: ' + event.type);
                    if (event.type === 'video') {
                        remoteVideo.mozSrcObject = event.stream;
                        remoteVideo.play();
                        $scope.hasRemoteVideo = true;
                        log('Set Remote Video Stream');

                    } else {
                        voice.mozSrcObject = event.stream;
                        voice.play();
                        log('Set Remote Audio Stream');
                    }
                } else {
                    // Chrome
                    // Set the remote video source even for audio-only streams
                    remoteVideo.src = webkitURL.createObjectURL(event.stream);
                    log('Set Remote Stream URL: ' + remoteVideo.src);

                    var videoTracks = event.stream.videoTracks || event.stream.getVideoTracks();
                    $scope.hasRemoteVideo = (videoTracks && videoTracks.length > 0);
                }
            });
        }


        function onRemoteStreamRemoved(event) {
            $scope.safeApply(function () {
                log('RTCPeerConnection - onremovestream');
                log('Removed Remote Stream: ' + angular.toJson(event.stream, true));
                // TODO: We currently don't have scenarios where a remote stream is removed
                //       Once we start supporting renegotiations using the same peer connection 
                //       we will need to handle this. 
            });
        }


        /////////////////////////////////////////////////////////////////////////////
        // Internal Functions
        /////////////////////////////////////////////////////////////////////////////
        function setCallStatus(newStatus) {
            if (newStatus !== $scope.callStatus) {
                log('Call Status changed from ' + $scope.callStatus + ' to ' + newStatus);
                $scope.callStatus = newStatus;
                if ($scope.callStatus === CallStatus.Established) {
                    setSdpStatus(SdpStatus.Established);
                    collectStats();
                }
            }
        }

        function setSdpStatus(newStatus) {
            if (newStatus !== $scope.sdpStatus) {
                log('SDP Status changed from ' + $scope.sdpStatus + ' to ' + newStatus);
                $scope.sdpStatus = newStatus;
            }
        }

        function sendMessage(name, data) {
            log('C->S [' + name + ']:\n' + angular.toJson(data, true));
            Socket.emit(name, data);
        }


        function getUserMediaForFirefox(onSuccess, onFailure) {
            // At the moment Firefox has some problems with audio & video in the 
            // same stream, so we need to get separate streams.
            navigator.mozGetUserMedia({audio: true, video: false}, function (audioStream) {
                $scope.safeApply(function () {
                    log('Granted access to local media (audio)');
                    localStreams.push(audioStream);

                    navigator.mozGetUserMedia({audio: false, video: true}, function (videoStream) {
                        $scope.safeApply(function () {
                            log('Granted access to local media (video)');
                            localStreams.push(videoStream);
                            localVideo.mozSrcObject = videoStream;
                            localVideo.play();
                            $scope.hasLocalVideo = true;
                            onSuccess();
                        });
                    }, onFailure);
                });
            }, onFailure);
        }


        function getUserMediaForChrome(onSuccess, onFailure) {
            navigator.webkitGetUserMedia({audio: true, video: true}, function (stream) {
                $scope.safeApply(function () {
                    log('Granted access to local media (audio and video)');
                    log('Local Media Stream: \n' + angular.toJson(stream, true));
                    localStreams.push(stream);
                    localVideo.src = webkitURL.createObjectURL(stream);
                    $scope.hasLocalVideo = true;
                    onSuccess();
                });
            }, onFailure);
        }


        function sendSignin(device) {
            sendMessage('wsSignin', {
                user: $scope.username,
                device: device
            });

            signinTimeout = window.setTimeout(function () {
                if (!$scope.isSignedIn) {
                    alert('Timed out waiting for server acknowledgment');
                    stopLocalStreams();
                }
            }, 5000);
        }

        //http://www.webrtc.org/interop
        //Even in DTLS-SRTP mode, Chrome will not accept offers that do not contain a=crypto lines. In order to call Chrome from Firefox you eed to supply a dummy a=crypto line for every m-line.
        //A fixed line is fine. For instance:
        //a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:BAADBAADBAADBAADBAADBAADBAADBAADBAADBAAD
        //IMPORTANT: Do not add an extra a=crypto line to offers provided by Chrome.

        function addDummyCryptoLine(sdp){
            var parsedSdp = sdpParser.parse(sdp.sdp);
            parsedSdp.m.forEach(function (m) {
                if (m.media !== 'application'){
                    m.a.push({field: 'crypto:1 AES_CM_128_HMAC_SHA1_80 inline:BAADBAADBAADBAADBAADBAADBAADBAADBAADBAAD'});
                }
            });
            sdp.sdp = sdpParser.stringify(parsedSdp);
        }

        function sendOffer(sdp) {

            if ($scope.isFirefox){
                addDummyCryptoLine(sdp);
            }

            if ($scope.callStatus === CallStatus.Initiating) {
                // This is a new call
                sendMessage('wsOffer', {
                    peer: $scope.activePeer,
                    sdp: sdp,
                    useRtpProxy: $scope.useRtpProxy,
                    srtpInterwork: $scope.srtpInterwork
                });
                setCallStatus(CallStatus.Calling);
            } else {
                // This is a media renegotiations
                sendMessage('wsOffer', {
                    peer: $scope.activePeer,
                    sdp: sdp
                });
            }
            setSdpStatus(SdpStatus.OfferSent);
        }


        function sendAnswer(sdp) {

            if ($scope.isFirefox){
                addDummyCryptoLine(sdp);
            }

            sendMessage('wsAnswer', {
                peer: $scope.activePeer,
                sdp: sdp
            });

            if (sdp.type === 'pranswer') {
                setSdpStatus(SdpStatus.PrAnswerSent);
            } else {
                setSdpStatus(SdpStatus.Established);
                setCallStatus(CallStatus.Established);
            }
        }

        function addLocalStreams() {
            // Prior to v26.0.1405.0 the local streams were available via 
            // the localStreams property.
            // Starting with v26.0.1405.0 Chrome has updated the RTCPeerConnection
            // interface to use the getLocalStreams() function.
            var pcStreams = pc.localStreams || pc.getLocalStreams();
            if (pcStreams.length === 0) {
                localStreams.forEach(function (stream) {
                    pc.addStream(stream);
                    log('Added Local Stream: ' + angular.toJson(stream, true));
                });
            }
        }


        function stopLocalStreams() {
            $scope.hasLocalVideo = false;
            if ($scope.isFirefox) {
                localVideo.pause();
                localVideo.mozSrcObject = null;
            } else {
                localVideo.src = '';
            }

            localStreams.forEach(function (stream) {
                try {
                    stream.stop();
                } catch (e) {
                    logError('Error stopping local stream. ', e);
                }
            });
            localStreams = [];
        }


        function disconnect(status, reason) {
            sendDisconnect(status, reason);
            stopCall();
        }


        function sendDisconnect(status, reason) {
            if ($scope.callStatus && $scope.callStatus !== CallStatus.Initiating) {
                status = status || 200;
                reason = reason || (status === 200 ? 'Normal Clearing' : '');
                sendMessage('wsDisconnect', {status: status, reason: reason});
            }
        }


        function stopCall() {
            audioRing.pause();
            setCallStatus(null);
            setSdpStatus(null);
            $scope.activePeer = null;

            clearRemoteMedia();

            window.clearInterval(statCollector);
            statCollector = null;

            if (pc) {
                pc.close();
                pc = null;
            }
        }


        function setLocalAndSendMessage(sdp) {
            $scope.safeApply(function () {
                updateLocalDescription(sdp);

                if (sdp.type === 'answer' && $scope.callStatus === CallStatus.Alerting) {
                    sdp.type = 'pranswer';
                }

                var localSdp = new SessionDescription({type: sdp.type, sdp: sdp.sdp});
                log('Successfully created Local Description: ' + angular.toJson(localSdp, true));

                try {
                    pc.setLocalDescription(localSdp, function () {
                        $scope.safeApply(function () {
                            log('Local Description was successfully applied');
                            if (sdp.type === 'offer') {
                                if ($scope.trickleIceForOffer) {
                                    sendOffer(sdp);
                                } else {
                                    setSdpStatus(SdpStatus.OfferPending);
                                }
                            } else if (sdp.type === 'answer') {
                                if ($scope.trickleIceForAnswer) {
                                    sendAnswer(sdp);
                                } else {
                                    setSdpStatus(SdpStatus.AnswerPending);
                                }
                            } else { // 'pranswer'
                                sendAnswer(sdp);
                            }
                        });
                    }, function (error) {
                        $scope.safeApply(function () {
                            log('Failed to apply Local Description: ' + error);
                            disconnect(500, 'WebRTC Error');
                        });
                    });

                } catch (e) {
                    // Firefox sometimes throws an exception instead of calling the error callback                
                    logError('Failed to apply Local Description: ', e);
                    disconnect(500, 'WebRTC Error');
                }
            });
        }


        function setRemoteDescription(data) {
            try {
                log('Setting Remote Description (' + data.type + ')');
                var sdp = new SessionDescription({type: data.type, sdp: data.sdp});
                checkVideo(sdp);
                pc.setRemoteDescription(sdp, function () {
                    $scope.safeApply(function () {
                        log('Remote Description was successfully applied.');

                        switch (sdp.type) {
                        case 'offer':
                            setSdpStatus(SdpStatus.OfferReceived);
                            if ($scope.callStatus === CallStatus.Established) {
                                // This is a renegotiation
                                createAndSendAnswer();
                            } else if ($scope.autoAnswer) {
                                setCallStatus(CallStatus.Answering);
                                createAndSendAnswer();
                            } else {
                                audioRing.play();
                                setCallStatus(CallStatus.Alerting);
                                if ($scope.sendPrAnswer) {
                                    createAndSendAnswer();
                                }
                            }
                            break;

                        case 'answer':
                            setSdpStatus(SdpStatus.Established);
                            setCallStatus(CallStatus.Established);
                            break;

                        case 'pranswer':
                            setSdpStatus(SdpStatus.PrAnswerReceived);
                            break;

                        default:
                            log('Unexpected SDP type: ' + sdp.type);
                            break;
                        }
                    });
                }, function (error) {
                    $scope.safeApply(function () {
                        log('Failed to apply remote description. ' + error);
                        disconnect(500, 'WebRTC Error');
                    });
                });
            } catch (e) {
                // Firefox sometimes throws an exception instead of calling the error callback                
                logError('Failed to apply remote description. ', e);
                disconnect(500, 'WebRTC Error');
            }
        }


        function createAndSendAnswer() {
            addLocalStreams();

            var constraints = {
                mandatory: {
                    'OfferToReceiveAudio': mediaConstraints.audio, 
                    'OfferToReceiveVideo': mediaConstraints.video
                }
            };

            log("Creating Local Description...");
            pc.createAnswer(setLocalAndSendMessage, function (error) {
                log('Failed to create Local Description: ' + error);
                disconnect(500, 'WebRTC Error');
            }, constraints);
        }


        function renegotiateMedia() {
            if (!createPeerConnection()) {
                disconnect(500, 'WebRTC Error');
                return;
            }

            addLocalStreams();

            var constraints = {
                mandatory: {
                    'OfferToReceiveAudio': mediaConstraints.audio,
                    'OfferToReceiveVideo': mediaConstraints.video
                }
            };

            if ($scope.isFirefox){
                constraints.mandatory.MozDontOfferDataChannel = true;
            }

            log('constraints: ' + angular.toJson(constraints, true));

            log('Creating new Local Description...');
            pc.createOffer(setLocalAndSendMessage, function (error) {
                log('Failed to create Local Description: ' + error);
                disconnect(500, 'WebRTC Error');
            }, constraints);
        }


        function checkVideo(sdp) {
            var parsedSdp = sdpParser.parse(sdp.sdp);

            var hasVideo = false;
            parsedSdp.m.forEach(function (m) {
                if (!hasVideo && (m.media === 'video') && (m.port !== 0)) {
                    hasVideo = true;
                    m.a.forEach(function (a) {
                        if (a.field === 'inactive') {
                            hasVideo = false;
                        }
                    });
                }
            });
            mediaConstraints.video = hasVideo;
        }


        function updateLocalDescription(sdp) {
            // Disable the multiplex of audio and video RTP packets
            sdp.sdp.replace(/a=group:BUNDLE audio video\r\n/, '');

            if (mediaConstraints.video) {
                return;
            }

            // Need to disable or remove the m-line for video
            var parsedSdp = sdpParser.parse(sdp.sdp);
            if (sdp.type !== 'offer') {
                // Set the video to inactive
                parsedSdp.m.forEach(function (m) {
                    if (m.media !== 'video') {
                        return;
                    }
                    var found = false;
                    m.a.forEach(function (a) {
                        switch (a.field) {
                        case 'sendrecv':
                        case 'sendonly':
                        case 'recvonly':
                            a.field = 'inactive';
                            found = true;
                            break;
                        }
                    });
                    if (!found) {
                        m.a.push({field: 'inactive'});
                    }
                });
            } else {
                parsedSdp.a.filter(function (a) {
                    return (a.field !== 'group');
                });

                 // Remove the m-line for vide
                 // (NOTE: Chrome does not accept the SDP if we just set the port to 0)
                var mediaLines = [];
                parsedSdp.m.forEach(function (m) {
                    if (m.media !== 'video') {
                        mediaLines.push(m);
                    }
                });
                parsedSdp.m = mediaLines;
            }
            sdp.sdp = sdpParser.stringify(parsedSdp);
        }


        function clearRemoteMedia() {
            if ($scope.isFirefox) {
                remoteVideo.pause();
                remoteVideo.mozSrcObject = null;
                voice.pause();
                voice.mozSrcObject = null;
            } else {
                remoteVideo.src = '';
            }
            $scope.hasRemoteVideo = false;
            log('Cleared Remote Media');
        }


        function enableAudio(enabled) {
            if ($scope.isFirefox) {
                alert('Not supported in Firefox.');
                return;
            }

            if (!pc){
                return;
            }

            var pcStreams = pc.localStreams || pc.getLocalStreams();
            if (pcStreams) {
                for (var i = 0; i < pcStreams.length; i++) {
                    var stream = pcStreams[i];
                    var audioTracks = stream.getAudioTracks();
                    for (var j = 0; j < audioTracks.length; j++) {
                        audioTracks[j].enabled = enabled;
                    }
                }
            }
        }


        function getMediaStreamData(stream) {
            var idx;
            var data = '{rs:' + stream.readyState;
            var audioTracks = stream.getAudioTracks();
            var videoTracks = stream.getVideoTracks();
            if (audioTracks.length > 0) {
                data += ',a:';
                for (idx = 0; idx < audioTracks.length; idx++) {
                    data += (idx === 0) ? '[' : ',[';
                    data += audioTracks[0].enabled ? 'on' : 'off';
                    data += ']';
                }
            }
            if (videoTracks.length > 0) {
                data += ',v:';
                for (idx = 0; idx < videoTracks.length; idx++) {
                    data += (idx === 0) ? '[' : ',[';
                    data += videoTracks[0].enabled ? 'on' : 'off';
                    data += ']';
                }
            }
            data += '}';
            return data;
        }


        function collectStats() {
            if (statCollector) {
                return;
            }
            // Display statistics   
            statCollector = window.setInterval(function () {
                $scope.safeApply(function () {
                    try {
                        $scope.audioStats = '';
                        $scope.videoStats = '';
                        if (!pc) {
                            return;
                        }
                        if (pc.remoteStreams && pc.remoteStreams.length > 0) {
                            if (pc.getStats) {
                                var audioTracks = pc.remoteStreams[0].getAudioTracks();
                                if (audioTracks.length > 0) {
                                    $scope.audioStats = 'No Stats';
                                    pc.getStats(function (stats) {
                                        log('Stats: ' + angular.toJson(stats, true));
                                        $scope.audioStats = angular.toJson(stats, true);
                                    }, pc.remoteStreams[0].getAudioTracks()[0]);
                                }

                                /* This is how the W3C spec specifies the getStats API

                                if (pc.remoteStreams[0].videoTracks.length > 0) {
                                    pc.getStats(pc.remoteStreams[0].videoTracks[0], function (stats) {
                                        $scope.videoStats = angular.toJson(stats,true);
                                    }, function (error) {
                                        $scope.videoStats = error;
                                        window.clearInterval(statCollector);
                                        statCollector = null;
                                    });
                                }
                                */
                            } else {
                                $scope.audioStats = 'No stats. Needs Chrome 24.0.1285 or higher.';
                                window.clearInterval(statCollector);
                                statCollector = null;
                            }
                        } else {
                            $scope.audioStats = 'No remote stream';
                        }
                    } catch (e) {
                        logError('Exception in collectStats(): ', e);
                        window.clearInterval(statCollector);
                        statCollector = null;
                    }
                });
            }, 10000);
        }

        // Initialization
        Environment.retrieve('user', function (username) {
            $scope.username = username;
        });

        Environment.retrieve('host', function (host) {
            if (Environment.getAppMode() === AppMode.BROWSER) {
                $scope.wshost = host || window.location.host;
            } else {
                $scope.wshost = host || '54.218.63.225';
            }
        });

        $scope.connectionState = WsConnectionState.Disconnected;


        // Logging 
        $scope.enableLog = true;
        $scope.logs = [];

        $scope.clearLog = function () {
            $scope.logs = [];
        };

        function logError(s, e) {
            log(s + (e.stack || e.message || e));
        }

        function log(s) {
            var n = s.replace(/\\r\\n/g, '\x0A'); //pretty display for SDP
            $scope.logs.unshift($filter('date')(new Date(), 'hh:mm:ss') + ' ' + n);
            if ($scope.logs.length > MAX_LOG_ENTRIES) {
                $scope.logs.pop();
            }
        }
    }]);



    angular.module('myApp').controller('PeerCtrl', ['$scope', '$filter', '$timeout', '$window', 'Socket', 'P2pSocket', function ($scope, $filter, $timeout, $window, Socket, P2pSocket) {
        var chime = document.getElementById('messageChime');
        var blue = 'rgba(82, 168, 236, 0.6)';

        $scope.isExpanded = false;
        $scope.isBlinking = false;
        $scope.text = '';
        $scope.history = '';

        $scope.getDeviceImage = function (peer) {
            switch (peer.device) {
            case 'chrome':
                return 'img/chrome32.png';
            case 'firefox':
                return 'img/firefox32.png';
            case 'ios':
                return 'img/iphone32.png';
            }
            return '';
        };

        $scope.im = function () {
            $scope.isExpanded = !$scope.isExpanded;
            $scope.isBlinking = false;
        };

        $scope.send = function (event) {
            var data = {peer: event.user, text: this.text};
            $scope.log('C->S [' + 'wsMessage' + ']:\n' + angular.toJson(data, true));
            P2pSocket.emit('wsMessage', data);
            add2History('me', $scope.text);
            $scope.text = '';
        };

        P2pSocket.on('wsMessage', $scope.peer.user, function (data) {
            $scope.log('S->C [wsMessage]:\n' + angular.toJson(data, true));

            if (requireNode) {
                window.LOCAL_NW.desktopNotifications.notify('img/webrtc.png', data.peer, data.text, function() {
                });            
            }
            
            if (!$scope.isExpanded) {
                $scope.isBlinking = true;
            }

            add2History(data.peer, data.text);

            if ($scope.enableChime && !$scope.isExpanded) {
                chime.play();
            }

            $scope.highlightStyle = {'background-color': blue};        
            $timeout(function () { $scope.highlightStyle = {}; }, 3000);
        });   

        function add2History(user, text) {
            if ($scope.history) {
                $scope.history += '\n';
            } else {
                $scope.history = '';
            }
            $scope.history += $filter('date')(new Date(), 'hh:mm:ss') + '  ' + user + ': ' + text;        
        }

    }]);

}());
