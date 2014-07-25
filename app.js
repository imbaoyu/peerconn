/*jshint es5:true*/

'use strict';

// Load Node.js Modules
var express = require('express');    // web app framework
var https = require('https');          // https server
var fs = require("fs");
var lessMiddleware = require('less-middleware');
var smoosh = require('smoosh');
var assetManager = require('connect-assetmanager');
var assetHandler = require('connect-assetmanager-handlers');


// Load my modules
var common = require('./server/common');  // Main App
var peerConnection = require('./server/peerConnection');  // Main App
var socketHandler = require('./server/socketHandler');    // WebSocket wrapper
var rtpAgent = require('./server/rtpAgent');


var argv = require('optimist')
    .usage('\nWebRTC OSMO server node script.\nUsage: $0 -p 8092\n       $0 --https-port 8092')
    .alias('p', 'https-port')
    .describe('p', 'HTTPS Port')
    .default('p', '8092')
    .argv;


var HTTPS_PORT = argv.p; 
var localAddress = common.localIp();

var Log = require('./server/logger').Log;
Log.info('Node Version         : ' + process.version);
Log.info('HTTPS Server Address  : ' + localAddress);
Log.info('HTTPS Server Port     : ' + HTTPS_PORT);

var root = __dirname + '/client';

// Local router function so that http and https can use same code
var register = function (app) {
    Log.info('App Settings : ' + common.inspect(app.settings));

    var debug = app.settings.env === 'development' ? true : false;
    var smooshConfig = JSON.parse(fs.readFileSync('./config.json', 'UTF-8'));
    var optimize = { '^': [assetHandler.uglifyJsOptimize] };
    var assets = {
        'js-libs': {
            debug: false,
            stale: !debug,
            route: /\/dist\/libs\.js/,
            path: './client/lib/',
            dataType: 'javascript',
            files: [ 
                'jquery-1.7.2.min.js', 
                'angular.min.js', 
                'angular-ui.js'
            ],
            postManipulate: debug ? {} : optimize
        },     
        js: {
            debug: debug,
            stale: !debug,
            route: /\/dist\/[^\/?*:;{}\\]+\.js/,
            path: './',
            dataType: 'javascript',
            files: smooshConfig.JAVASCRIPT.code,
            postManipulate: debug ? {} : optimize
        },
        css3: {
            route: /\/dist\/[^\/?*:;{}\\]+\.css/,
            path: './client/css/',
            dataType: 'css',
            files: [ 
                'bootstrap.min.css', 
                'main.css' 
            ],
            preManipulate: {
                '^': [
                    assetHandler.fixVendorPrefixes,
                    assetHandler.fixGradients,
                    assetHandler.replaceImageRefToBase64(root)
                ]
            }            
        }
    };
    var assetsMiddleware = assetManager(assets);

    // config middleware
    app.configure(function () {
        
        app.use(express.logger());    // enable to see all http requests
        app.use(express.cookieParser());

        //only enable json and urlencoded content-types
        app.use(express.bodyParser());    
        app.use(express.json());
        app.use(express.urlencoded());
        app.use(express.methodOverride());

        if (debug)
        {
            Log.info('Running in development mode');
            app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));           

            // only using smoosh for jshint validation   
            smoosh.config('./jshint-client.json').clean().run().done(function () {
                console.log('Smoosh finished processing the Client side files.\r\n');
            });
            // only using smoosh for jshint validation   
            smoosh.config('./jshint-server.json').clean().run().done(function () {
                console.log('Smoosh finished processing the Server side files.\r\n');
            });

            // compile less into css. concatenation done via @imports
            app.use(lessMiddleware({
                dest: root + '/css',
                src: root + '/less',
                prefix: '/css',
                yuicompress: true,
                optimization: 2,
                force: debug,
                debug: debug
            }));

            // js concat only
            app.use(assetsMiddleware);          
        }
        else 
        {
            Log.info('Running in production mode');
            app.use(express.errorHandler()); 

            // js concat, minify and compress
            app.use(assetsMiddleware);          
        }

        //app.use('/pc', express.static(__dirname + '/client'));
        app.use(express['static'](root));

    });
};

// Use new version of express
var app = express();

// Setup Web App
register(app);

// Start HTTPS server
var httpServer = https.createServer({
    key: fs.readFileSync('./cert/server-key.pem'),
    cert: fs.readFileSync('./cert/server-cert.pem'),
    requestCert: true,
    ca: fs.readFileSync('./cert/client-cert.pem')
}, app);
httpServer.listen(HTTPS_PORT);
Log.info('Started HTTPS Server on port ' + HTTPS_PORT);

// Start WebSocket server
socketHandler.start('websocket', httpServer, peerConnection.SocketHandler);

//Start the RTP Proxy Agent
rtpAgent.start('127.0.0.1', 5181);

