javascript
#!/usr/bin/env node
/**
 * QClaw 容器心跳唤醒脚本
 * 
 * 原理：通过 QClaw API 获取 accessToken，连接 WebSocket 网关，
 * 触发 QClaw 平台唤醒容器，使容器内的定时任务可以正常执行。
 * 
 * 用法：node heartbeat.js
 * 
 * 环境变量：
 *   QCLAW_APP_ID     - QClaw 应用 ID
 *   QCLAW_APP_SECRET - QClaw 应用密钥
 */

const https = require('https');
const { WebSocket } = require('ws');

// ============ 配置 ============
const API_URL = process.env.WS_CONN_DOMAIN || 'jprx.m.qq.com';
``````javascript
const WS_URL = process.env.WS_CONN_DOMAIN || 'mmgrcalltoken.3g.qq.com';
const APP_ID = process.env.QCLAW_APP_ID;
const APP_SECRET = process.env.QCLAW_APP_SECRET;

if (!APP_ID || !APP_SECRET) {
  console.error('❌ 请设置环境变量 QCLAW_APP_ID 和 QCLAW_APP_SECRET');
  process.exit(1);
}

// ============ 步骤1：获取 accessToken ============
function fetchAccessToken() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      app_id: APP_ID,
      app_secret: APP_SECRET,
      device_name: 'OpenClaw-heartbeat',
      device_info: JSON.stringify({
        hostname: 'heartbeat-service',
        platform: 'linux',
        arch: 'x64',
      }),
    });

    const endpoint = `https://${API_URL}/api/v1/4278`;

    const req = https.request(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json?.common?.code === 0 && json?.data?.access_token) {console.log(`✅ 步骤1完成：accessToken 获取成功 (expires_in=${json.data.expires_in}s)`);
            resolve(json.data.access_token);
          } else {
            reject(new Error(`API返回错误: code=${json?.common?.code}, msg=${json?.common?.message}`));
          }
        } catch (e) {
          reject(new Error(`解析响应失败: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.write(body);
    req.end();
  });
}

// ============ 步骤2：连接 WebSocket 网关 ============
function connectAndHeartbeat(accessToken) {
  return new Promise((resolve, reject) => {
    const wsUrl = `wss://${WS_URL}/agentwss/remotews?token=${encodeURIComponent(accessToken)}`;
    console.log(`🔗 步骤2：连接 WebSocket 网关 ${WS_URL}...`);const ws = new WebSocket(wsUrl);
    let resolved = false;
    let heartbeatCount = 0;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.log('⏰ 连接超时，安全退出');
        try { ws.close(); } catch {}
        resolve({ ok: true, heartbeatCount });
      }
    }, 30000); // 30秒后自动断开

    ws.on('open', () => {
      console.log('✅ 步骤2完成：WebSocket 连接成功！');
      console.log('💓 开始发送心跳...');
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.method === 'ready' || msg.type === 'ready') {
          console.log(`✅ 步骤3完成：网关就绪！mode=${msg.payload?.mode || msg.mode || 'unknown'}`);
          console.log('🎉 容器心跳唤醒成功！容器已被唤醒或保持活跃。');
          
          // 发送几个心跳包保持连接活跃
          const heartbeatInterval =setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.ping();
              heartbeatCount++;
              if (heartbeatCount <= 3) {
                console.log(`💓 心跳 #${heartbeatCount} 已发送`);
              }
            }
          }, 5000);

          // 15秒后断开（足够唤醒容器了）
          setTimeout(() => {
            clearInterval(heartbeatInterval);
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              console.log(`✅ 心跳完成（共发送 ${heartbeatCount} 次），安全断开连接`);
              try { ws.close(); } catch {}
              resolve({ ok: true, heartbeatCount });
            }
          }, 15000);
        } else if (msg.type === 'ping' || msg.method === 'ping') {
          // 回复 pong
          const envelope = {msg_id: require('crypto').randomUUID(),
            method: 'pong',
            envelop_type: 'notification',
            payload: {},
          };
          ws.send(JSON.stringify(envelope));
        }
      } catch (e) {
        // 忽略解析错误
      }
    });

    ws.on('close', (code, reason) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        if (code === 1006) {
          // 异常关闭，可能是容器还没启动
          console.log('⚠️ WebSocket 异常关闭 (code=1006)，可能是容器正在启动中');
          console.log('💡 建议：等待1-2分钟后再运行一次');
          resolve({ ok: false, heartbeatCount, code });
        } else {
          console.log(`WebSocket 关闭: code=${code}`);
          resolve({ ok: true, heartbeatCount, code });
        }
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);if (!resolved) {
        resolved = true;
        console.error(`❌ WebSocket 错误: ${err.message}`);
        resolve({ ok: false, heartbeatCount: 0, error: err.message });
      }
    });
  });
}

// ============ 主流程 ============
async function main() {
  console.log('🚀 QClaw 容器心跳唤醒脚本');
  console.log(`⏰ 运行时间: ${new Date().toISOString()}`);
  console.log('');

  try {
    // 步骤1：获取 accessToken
    const accessToken = await fetchAccessToken();

    // 步骤2：连接 WebSocket 并发送心跳
    const result = await connectAndHeartbeat(accessToken);

    console.log('');
    console.log('========== 执行结果 ==========');
    if (result.ok) {
      console.log('✅ 心跳唤醒成功！');
      console.log(`   心跳次数: ${result.heartbeatCount}`);
    } else {
      console.log('⚠️ 心跳唤醒可能失败');
      console.log(`   错误: ${result.error|| '未知'}`);
    }
    console.log('================================');
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    console.error(`❌ 执行失败: ${err.message}`);
    process.exit(1);
  }
}

main();
