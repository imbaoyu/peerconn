'use strict';

var os = require('os');
var util = require('util');
 

function inspect(obj, depth) {	
	return '\r\n' + util.inspect(obj, false, (depth ? depth : null), false) + '\r\n';
}
exports.inspect = inspect;


function rstring() {
	return Math.floor(Math.random() * 1e9).toString();
}
exports.rstring = rstring;


function rinteger() {
    return Math.floor(Math.random() * 1e9);
}
exports.rinteger = rinteger;


var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
function genRandomString(length) {
    length = length || 10;  // Default length
    
    var str = '';
    for (var idx = 0; idx < length; idx++) {
        str += chars[Math.floor(Math.random() * chars.length)];
    }   
    return str;
}
exports.genRandomString = genRandomString;


function getIP4Address(iface) {
    var result = null;
    iface.forEach(function (details) {
        if (!result && details.family === 'IPv4' && details.internal === false) {
            result = details.address;
        }
    });
    return result;
}


function localIp() {
    var result = null;
    var ifaces = os.networkInterfaces();
    console.log('Available Network Interfaces' + inspect(ifaces));

    for (var name in ifaces) {
        if (ifaces.hasOwnProperty(name)) {
            // Skip the loopback interface
            if (name === 'lo') {
                continue;
            }

            result = getIP4Address(ifaces[name]);
            if (result) {
                console.log('Found local address: ' + result);
                break;
            }
        }
    }   
    return result;
}
exports.localIp = localIp;


function generateTag() {
    return ['tag_', Math.round(Math.random() * 1000000)].join('');
}
exports.generateTag = generateTag;