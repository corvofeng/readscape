#!/usr/bin/env node
// 验证脚本：在调试浏览器中新开 NGA 页面，检查油猴脚本是否生效并截图。
// 用法: CDP_URL=http://主机:9222 node scripts/verify-tm.mjs [url] [截图路径]
import { writeFileSync } from 'node:fs';

import { normalizeEndpoint, debuggerUrl, discover, connect } from './cdp.mjs';

const CDP = normalizeEndpoint(process.env.CDP_URL);
const TARGET_URL = process.argv[2] || 'https://bbs.nga.cn/thread.php?stid=47206901&rand=402';
const SHOT_PATH = process.argv[3] || '/tmp/readscape-tm-shot.png';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let version;
try {
  version = await discover(CDP, '/json/version');
} catch (error) {
  console.error(`无法访问调试浏览器 ${CDP}: ${error.message}。请检查 CDP_URL、网络或运行 scripts/dev-browser.sh。`);
  process.exit(1);
}
console.log('browser:', version.Browser);

const tab = await discover(CDP, `/json/new?${encodeURIComponent(TARGET_URL)}`, { method: 'PUT' });
const client = await connect(debuggerUrl(tab.webSocketDebuggerUrl, CDP));
const send = client.send;

try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(8000);
  // NGA 会改写 rand 参数二次跳转，再导航一次确保停在最终页面
  await send('Page.navigate', { url: TARGET_URL });
  await sleep(8000);

  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const host = document.getElementById('nga-cards-host');
      const cards = host?.shadowRoot ? host.shadowRoot.querySelectorAll('.card').length : 0;
      const fab = host?.shadowRoot ? !!host.shadowRoot.querySelector('.rt-fab') : false;
      return JSON.stringify({ url: location.href, title: document.title, host: !!host, cards, fab });
    })()`,
    returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error('页面验证执行失败');
  const check = JSON.parse(r.result.value);
  console.log('check:', check);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(SHOT_PATH, Buffer.from(shot.data, 'base64'));
  console.log('screenshot:', SHOT_PATH);
  if (!check.host || !check.fab) {
    console.error('阅境未生效：请确认远端 Tampermonkey 已安装并启用 dist/readscape-nga.user.js，且 NGA 页面已正常加载。');
    process.exitCode = 1;
  }
} finally {
  client.close();
}
