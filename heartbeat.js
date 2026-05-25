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
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      app_id: APP_ID,
      app_secret: APP_SECRET,
      device_name: 'GitHub-Actions-Heartbeat',
      device_info: JSON.stringify({ hostname: 'github-actions', platform: 'linux', arch: 'x64' }),
    });
    const req = https.request({
      hostname: API_URL,
      path: '/api/v1/4278',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () 
=> {
        try {
          const json = JSON.parse(data);
          if (json?.common?.code === 0 && json?.data?.access_token) {
            console.log('accessToken obtained successfully');
            resolve(json.data.access_token);
          } else {
            reject(new Error(`API error: code=${json?.common?.code}`));
          }
        } catch (e) {
          reject(new Error(`Parse failed: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(body);
    req.end();
  });
}

function sendHeartbeat(accessToken) {
  return new Promise((resolve, reject) => {
    const wsUrl = `wss://${WS_URL}/agentwss/remotews?token=${encodeURIComponent(accessToken)}`;
    console.log('Connecting to WebSocket...');
    const ws = new WebSocket(wsUrl);
    let resolved = false;

    ws.on('open', () => {
      console.log('WebSocket connected! Sending heartbeat...');
      ws.send(JSON.stringify({
        msg_id: require('crypto').randomUUID(),
        method: 'remotesession.heartbeat',
        envelop_type: 'notification',
        payload: { text: 'Heartbeat wakeup', timestamp: Date.now() },
      }));
    });

    ws.on('message', (raw) => {
      console.log('Received message from WebSocket');
      if (!resolved) {
        resolved = true;
        console.log('Heartbeat sent successfully!');
        ws.close();
        resolve();
      }
    });

    ws.on('close', () => {
      if (!resolved) {
        resolved = true;
        console.log('WebSocket closed (heartbeat sent)');
        resolve();}
    });

    ws.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        console.error(`WebSocket error: ${err.message}`);
        reject(err);
      }
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.log('Timeout, forcing close');
        ws.close();
        resolve();
      }
    }, 10000);
  });
}

async function main() {
  console.log('QClaw container heartbeat script started');
  try {
    const token = await fetchAccessToken();
    console.log(`Token obtained, first 10 chars: ${token.slice(0, 10)}...`);
    await sendHeartbeat(token);
    console.log('DONE! Container should be awake now.');
    process.exit(0);
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
    process.exit(1);
  }
}
main();
