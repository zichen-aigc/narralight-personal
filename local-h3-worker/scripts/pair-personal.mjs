import { resolve } from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { pair } from '../src/cli.mjs';
const config = await loadConfig(resolve(process.argv[2] || 'local-h3-worker/config.json'), { requireIdentity: false });
const url = new URL(config.serverBaseUrl);
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('个人配对仅支持本机 HTTP 平台。');
const request = async (path, options) => {
  const response = await fetch(new URL(path, url), { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`平台请求失败：HTTP ${response.status}`);
  return response.json();
};
const health = await request('/api/local/health');
if (health.deploymentProfile !== 'personal_local' || health.instanceKind !== 'standard') throw new Error('目标不是叙光个人版，停止配对。');
const { pairingCode } = await request('/api/local/h3/workers/pairing-codes', { method: 'POST' });
await pair(config, { pairingCode });
console.log('个人 H3 Worker 已配对。请用同一 Windows 用户启动 Worker。');
