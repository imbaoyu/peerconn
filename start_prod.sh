#!/bin/bash
NODE_ENV=production
SERVICE='rtpproxy'
RTPPROXY_PORT=5181
RTP_TIMEOUT=120

NODE_DEBUG_PORT=5858
HTTP_PORT=8092

echo "NODE_ENV set to $NODE_ENV"

if ps ax | grep -v grep |grep $SERVICE > /dev/null

then
	echo "$SERVICE is running"

else
	sudo ldconfig /usr/local/lib
	RTP_ADDR=`ifconfig | grep 'inet addr:' | grep -v '127.0.0.1' | cut -d: -f2 | awk '{ print $1}'`
	USER_NAME=`who am i | cut -d' ' -f1`
	echo "Start $SERVICE at $RTP_ADDR for $USER_NAME"
	rtpproxy -l $RTP_ADDR -u $USER_NAME -s udp:127.0.0.1:$RTPPROXY_PORT -T $RTP_TIMEOUT -d DBUG
fi

node --debug=$NODE_DEBUG_PORT app.js --http-port $HTTP_PORT
