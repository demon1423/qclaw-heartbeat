#!/usr/bin/env node
const https = require('https');
const WebSocket = require('ws');

const API_URL = process.env.WS_CONN_DOMAIN || 'jprx.m.qq.com';
const WS_URL = process.env.WS_CONN_DOMAIN || 'mmgrcalltoken.3g.qq.com';
const APP_ID = process.env.QCLAW_APP_ID;
const APP_SECRET = process.env.QCLAW_APP_SECRET;

if (!
```APP_ID || !APP_SECRET) {
  console.error('❌ 请设置环境变量 QCLAW_APP_ID 和 QCLAW_APP_SECRET');
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
      res.on('end', () => {
        try {
          const json =JSON.parse(data);
          if (json?.common?.code === 0 && json?.data?.access_token) {
            console.log(`✅ accessToken 获取成功`);
            resolve(json.data.access_token);
          } else {
            reject(new Error(`API错误: code=${json?.common?.code}`));
          }
        } catch (e) {
          reject(new Error(`解析失败: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.write(body);
    req.end();
  });
}

function sendHeartbeat(accessToken) {
  return new Promise((resolve, reject) => {
    const wsUrl = `wss://${WS_URL}/agentwss/remotews?token=${encodeURIComponent(accessToken)}`;
    console.log(`🔗 连接 WebSocket...`);
    const ws = new WebSocket(wsUrl);
    letresolved = false;

    ws.on('open', () => {
      console.log('✅ WebSocket 连接成功！发送心跳...');
      // 发送一个心跳消息（随意文本，目的是唤醒容器）
      ws.send(JSON.stringify({
        msg_id: require('crypto').randomUUID(),
        method: 'remoteSess.heartbeat',
        envelop_type: 'notification',
        payload: { text: '💓 心跳唤醒', timestamp: Date.now() },
      }));
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        console.log(`📩 收到消息: ${msg.method || msg.type || 'unknown'}`);
        if (!resolved) {
          resolved = true;
          console.log('✅ 心跳发送成功，容器已唤醒！');
          ws.close();
          resolve();
        }
      } catch (e) {
        // ignore parse errors
      }
    });

    ws.on('close', () => {
      if (!resolved) {
        resolved =true;
        console.log('✅ WebSocket 关闭（心跳已发送）');
        resolve();
      }
    });

    ws.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        console.error(`❌ WebSocket 错误: ${err.message}`);
        reject(err);
      }
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.log('⏰ 超时，强制关闭');
        ws.close();
        resolve();
      }
    }, 10000); // 10秒超时
  });
}

async function main() {
  console.log('🚀 QClaw 容器心跳唤醒脚本启动');
  try {
    const token = await fetchAccessToken();
    await sendHeartbeat(token);
    console.log('🎉 完成！容器已被唤醒。');
    process.exit(0);
  } catch (err) {
    console.error(`❌ 失败: ${err.message}`);
    process.exit(1);
  }
}
main();
