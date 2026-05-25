#!/usr/bin/env node
const https = require('https');
const WebSocket = require('ws');

const API_URL = process.env.WS_CONN_DOMAIN || 'jprx.m.qq.com';
const WS_URL = process.env.WS_CONN_DOMAIN || 'mmgrcalltoken.3g.qq.com';
const APP_ID = process.env.QCLAW_APP_ID;
const APP_SECRET = process.env.QCLAW_APP_SECRET;

if (!APP_ID || !APP_SECRET) {
  console.error('ERROR: Please set QCLAW_APP_ID and QCLAW_APP_SECRET');
  process.exit(1);
}

function fetchAccessToken() {
  var body = JSON.stringify({
    app_id: APP_ID,
    app_secret: APP_SECRET,
    device_name: 'GitHub-Actions-Heartbeat',
    device_info: JSON.stringify({ hostname: 'github-actions', platform: 'linux', arch: 'x64' }),
  });

  return new Promise(function(resolve, reject) {
    var options = {
      hostname: API_URL,
      path: '/api/v1/4278',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 15000,
    };

    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var json = JSON.parse(data);
          if (json && json.common && json.common.code === 0 && json.data && json.data.access_token) {
            console.log('accessToken obtained successfully');
            resolve(json.data.access_token);
          } else {
            reject(new Error('API error: code=' + (json && json.common && json.common.code)));
          }
        } catch (e) {
          reject(new Error('Parse failed: ' + data.slice(0, 200)));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('Request timeout')); });
    req.write(body);
    req.end();
  });
}

function sendHeartbeat(accessToken) {
  var wsUrl = 'wss://' + WS_URL + '/agentwss/remotews?token=' + encodeURIComponent(accessToken);
  console.log('Connecting to WebSocket...');

  return new Promise(function(resolve, reject) {
    var ws = new WebSocket(wsUrl);
    var resolved = false;

    ws.on('open', function() {
      console.log('WebSocket connected! Sending heartbeat...');
      ws.send(JSON.stringify({
        msg_id: require('crypto').randomUUID(),
        method: 'remotesess.heartbeat',
        envelop_type: 'notification',
        payload: { text: 'Heartbeat wakeup', timestamp: Date.now() },
      }));
    });

    ws.on('message', function(raw) {
      console.log('Received message from WebSocket');
      if (!resolved) {
        resolved = true;
        console.log('Heartbeat sent successfully!');
        ws.close();
        resolve();
      }
    });

    ws.on('close', function() {
      if (!resolved) {
        resolved = true;
        console.log('WebSocket closed (heartbeat sent)');
        resolve();
      }
    });

    ws.on('error', function(err) {
      if (!resolved) {
        resolved = true;
        console.error('WebSocket error: ' + err.message);
        reject(err);
      }
    });

    setTimeout(function() {
      if (!resolved) {
        resolved = true;
        console.log('Timeout, forcing close');
        ws.close();
        resolve();
      }
    }, 10000);
  });
}

function main() {
  console.log('QClaw container heartbeat script started');
  fetchAccessToken().then(function(token) {
    console.log('Token obtained, first 10 chars: ' + token.slice(0, 10) + '...');
    return sendHeartbeat(token);
  }).then(function() {
    console.log('DONE! Container should be awake now.');
    process.exit(0);
  }).catch(function(err) {
    console.error('FAILED: ' + err.message);
    process.exit(1);
  });
}

main();
