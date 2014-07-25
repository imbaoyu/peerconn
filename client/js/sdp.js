// The code in this module is based on the sip.js module and has been 
// modified for WOSMO

/* sip.js *********************************************************************

Copyright (c) 2010 Kirill Mikhailov (kirill.mikhailov@gmail.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

******************************************************************************/

var sdpParser = (function () {
    'use strict';

    function parseO(o) {
        var t = o.split(/\s+/);
        return { username: t[0], id: t[1], version: t[2], nettype: t[3], addrtype: t[4], address: t[5] };
    }

    function parseC(c) {
        var t = c.split(/\s+/);
        return { nettype: t[0], addrtype: t[1], address: t[2] };
    }

    function parseA(a) {
        var tmp = /^([^:]+)(?::(.*))?/.exec(a); 
        return { field: tmp[1], value: tmp[2] };
    }

    var reM = /^(\w+) +(\d+)(?:\/(\d))? +(\S+) (\d+( +\d+)*)/;
    function parseM(m) {
        var tmp = reM.exec(m);

        return {
            media: tmp[1], 
            port: +tmp[2],
            portnum: +(tmp[3] || 1),
            proto: tmp[4],
            fmt: tmp[5].split(/\s+/).map(function (x) { return +x; })
        };
    }

    function push(o, i, v) {
        switch (i) {
        case 'v':
        case 'o':
        case 's':
        case 'i':
        case 'u':
        case 'e':
        case 'p':
        case 'c':
            o[i] = v;
            break;
        default:
            if (o[i]) {
                o[i].push(v);
            } else {
                o[i] = [v];
            }
            break;
        }
    }

    var stringifiers = {
        o: function (o) {
            return [o.username || '-', o.id, o.version, o.nettype || 'IN', o.addrtype || 'IP4', o.address].join(' '); 
        },
        c: function (c) {
            return [c.nettype || 'IN', c.addrtype || 'IP4', c.address].join(' ');
        },
        m: function (m) {
            return [m.media || 'audio', m.port || '0', m.proto || 'RTP/AVP', m.fmt.join(' ')].join(' ');
        },
        a: function (a) {
            return a.value ? [a.field, a.value].join(':') : a.field;
        }
    };

    function stringifyParam(sdp, type, def) {
        if (sdp[type] !== undefined) {
            var stringifier = function (x) { return type + '=' + ((stringifiers[type] && stringifiers[type](x)) || x) + '\r\n'; };

            if (Array.isArray(sdp[type])) {
                return sdp[type].map(stringifier).join('');
            }
            return stringifier(sdp[type]);
        }

        if (def) {
            return type + '=' + def + '\r\n';
        }
        return '';
    }

    return {
        parse: function (sdp) {
            var tmpSdp = sdp.split(/\r\n/);
            var tmp = null;

            var result = {};

            // First parse the session level attributes
            for (var i = 0; i < tmpSdp.length; ++i) {
                tmp = /^(\w)=(.*)/.exec(tmpSdp[i]);

                if (tmp[1] === 'm') {
                    break;
                }
                else {
                    if (tmp[1] === 'a' && tmp[2]) {
                        push(result, tmp[1], parseA(tmp[2]));
                    } else {
                        push(result, tmp[1], tmp[2]);
                    }
                }
            }

            result.m = [];
            var m = null;

            // Now let's parse the media lines and their attributes
            for (;i < tmpSdp.length; ++i) {
                tmp = /(\w)=(.*)/.exec(tmpSdp[i]);

                if (!tmp) {
                    break;
                }

                if (tmp[1] === 'm') {
                    m = parseM(tmp[2]);
                    result.m.push(m);
                }
                else {
                    if (tmp[1] === 'a' && tmp[2]) {
                        push(m, tmp[1], parseA(tmp[2]));
                    } else {
                        push(m, tmp[1], tmp[2]);
                    }
                }
            }

            if (!result.s || result.s === '') {
                result.s = '-';
            }
            if (result.o) {
                result.o = parseO(result.o);
            }
            if (result.c) {
                result.c = parseC(result.c);
            }
            result.m.forEach(function (m) {
                if (m.c) {
                    m.c = parseC(m.c);
                }
            });

            return result;
        },

        stringify: function (sdp) {
            var s = '';

            s += stringifyParam(sdp, 'v', 0);
            s +=  stringifyParam(sdp, 'o');
            s +=  stringifyParam(sdp, 's', '-');
            s +=  stringifyParam(sdp, 'i');
            s +=  stringifyParam(sdp, 'u');
            s +=  stringifyParam(sdp, 'e');
            s +=  stringifyParam(sdp, 'p');
            s +=  stringifyParam(sdp, 'c');
            s +=  stringifyParam(sdp, 'b');
            s +=  stringifyParam(sdp, 't', '0 0');
            s +=  stringifyParam(sdp, 'r');
            s +=  stringifyParam(sdp, 'z');
            s +=  stringifyParam(sdp, 'k');
            s +=  stringifyParam(sdp, 'a');
            sdp.m.forEach(function (m) {
                s += stringifyParam({m: m}, 'm');
                s +=  stringifyParam(m, 'i');
                s +=  stringifyParam(m, 'c');
                s +=  stringifyParam(m, 'b');
                s +=  stringifyParam(m, 'k');
                s +=  stringifyParam(m, 'a');
            });

            return s;
        }
    };

}());

// The following statement is used to prevent an 'unused variable' error in JSHint 
sdpParser = sdpParser;
