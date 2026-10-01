#!/usr/bin/env node
// 验证脚本：在调试浏览器中新开 NGA 页面，检查油猴脚本是否生效并截图。
// 用法: node scripts/verify-tm.mjs [url] [截图路径]
import { writeFileSync } from 'node:fs';

const CDP = 'http://localhost:9222';
const TARGET_URL = process.argv[2] || 'https://bbs.nga.cn/thread.php?stid=47206901&rand=402';
const SHOT_PATH = process.argv[3] || '/tmp/readscape-tm-shot.png';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let version;
try {
  version = await (await fetch(`${CDP}/json/version`)).json();
} catch {
  console.error('调试浏览器未启动，先运行 scripts/dev-browser.sh');
  process.exit(1);
}
console.log('browser:', version.Browser);

const tab = await (await fetch(`${CDP}/json/new?${encodeURIComponent(TARGET_URL)}`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(8000);
// NGA 会改写 rand 参数二次跳转，再导航一次确保停在最终页面
await send('Page.navigate', { url: TARGET_URL }).catch(() => {});
await sleep(8000);

const r = await send('Runtime.evaluate', {
  expression: `(() => {
    const host = document.getElementById('nga-cards-host');
    const cards = host ? host.shadowRoot.querySelectorAll('.card').length : 0;
    const fab = host ? !!host.shadowRoot.querySelector('.rt-fab') : false;
    return JSON.stringify({ url: location.href, title: document.title, host: !!host, cards, fab });
  })()`,
  returnByValue: true,
});
console.log('check:', r.result.value);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(SHOT_PATH, Buffer.from(shot.data, 'base64'));
console.log('screenshot:', SHOT_PATH);
ws.close();
process.exit(0);
