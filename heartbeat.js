#!/usr/bin/env node
const https = require('https');
const { WebSocket } = require('ws');

const API_URL = process.env.WS_CONN_DOMAIN || 'jprx.m.qq.com';
const WS_URL = process.env.WS_CONN_DOMAIN || 'mmgrcalltoken.3g.qq.com';
const APP_ID = process.env.QCLAW_APP_ID;
const APP_SECRET = process.env.QCLAW_APP_SECRET;

if (!APP_ID || !APP_SECRET) {
  console.error('❌ 请设置环境变量 QCLAW_APP_ID 和 QCLAW_APP_SECRET');
  process.exit(1);
}

function fetchAccessToken() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      app_id: APP_ID,
      app_secret: APP_SECRET,
      device_name: 'OpenClaw-heartbeat',
      device_info: JSON.stringify({ hostname: 'heartbeat-service', platform: 'linux', arch: 'x64' }),
    });
    const req = https.request({
      hostname: API_URL,
      path: '/api/v1/4278',
``````javascript
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json?.common?.code === 0 && json?.data?.access_token) {
            console.log(`✅ accessToken 获取成功 (expires_in=${json.data.expires_in}s)`);
            resolve(json.data.access_token);
          } else {
            reject(new Error(`API错误: code=${json?.common?.code}, msg=${json?.common?.message}`));
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

async function main() {
  console.log('🚀 QClaw 容器心跳唤醒脚本');
  try {
    const token = await fetchAccessToken();
    console.log(`✅ 完成！token前10位: ${token.slice(0, 10)}...heartbeat:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: Install dependencies
        run: npm install
      - name: Run heartbeat
        env:
          QCLAW_APP_ID: ${{ secrets.QCLAW_APP_ID }}
          QCLAW_APP_SECRET: ${{ secrets.QCLAW_APP_SECRET }}
        run: node heartbeat.js
