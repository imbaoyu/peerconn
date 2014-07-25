'use strict';

// Load Node.js Modules
var winston = require('winston');
var common = require('./common');

var logger = new winston.Logger({
    transports: [
        new winston.transports.Console({
            colorize: true,                     
            timestamp: true
        })
        /*
        new (winston.transports.File)({
            colorize: false,                    
            timestamp: true,
            filename: ...,
            maxsize: 1048576,  // 1 KB
            maxFiles: 20,
            json: false
        })
        */
    ]
});

var Log = {
    DEBUG: 1,
    INFO: 2,
    WARNING: 3,
    ERROR: 4,

    severity : 1,  // DEBUG
    
    debug : function (msg, obj) {
        if (Log.severity <= Log.DEBUG) {
            if (obj) {
                msg = msg + common.inspect(obj);
            }             
            logger.debug(msg);
        }
    },
    info : function (msg, obj) {
        if (Log.severity <= Log.INFO) {
            if (obj) {
                msg = msg + common.inspect(obj);
            }             
            logger.info(msg);
        }
    },
    warning : function (msg, obj) {
        if (Log.severity <= Log.WARNING) {
            if (obj) {
                msg = msg + common.inspect(obj);
            }             
            logger.warn(msg);
        }
    },
    error : function (err, obj) {
        var msg = err.stack || err;
        if (obj) {
            msg = msg + common.inspect(obj);
        }             
        logger.error(msg);
    }
};
exports.Log = Log;