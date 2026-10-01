#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFileSync, readdirSync, watch } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} 缺少参数`);
  return args[index + 1];
}
for (let i = 0; i < args.length; i += 2) {
  if (!['--host', '--port', '--origin', '--adapter'].includes(args[i])) throw new Error(`未知参数: ${args[i]}`);
}
const host = option('--host', process.env.DEV_HOST || '0.0.0.0');
const port = Number(option('--port', process.env.DEV_PORT || '5173'));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('无效端口');
const id = option('--adapter', 'nga');
const ids = readdirSync(resolve(root, 'src/adapters'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
if (!ids.includes(id)) throw new Error(`未知适配器: ${id}`);
const lan = Object.values(networkInterfaces()).flat().find(n => n.family === 'IPv4' && !n.internal)?.address || 'localhost';
const advertisedHost = ['0.0.0.0', '::'].includes(host) ? lan : host;
const origin = new URL(option('--origin', process.env.DEV_ORIGIN || `http://${advertisedHost}:${port}`));
if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('--origin 必须是浏览器可访问的 http(s)://主机:端口');
}
const base = origin.origin;
let bundle, revision, buildError;
function build() {
  const result = spawnSync(process.execPath, ['scripts/build.mjs', id], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    buildError = result.stderr || result.stdout || '构建失败';
    console.error(buildError);
    return false;
  }
  bundle = readFileSync(resolve(root, `dist/readscape-${id}.user.js`), 'utf8');
  revision = createHash('sha256').update(bundle).digest('hex');
  buildError = null;
  console.log(`[${new Date().toLocaleTimeString()}] 构建就绪 ${revision.slice(0, 8)}`);
  return true;
}
if (!build()) process.exit(1);

function header(extra) {
  return bundle.slice(0, bundle.indexOf('// ==/UserScript==')).trimEnd() + '\n' + extra.join('\n') + '\n// ==/UserScript==\n';
}
function loader() {
  return header([
    '// @grant        GM_xmlhttpRequest',
    `// @connect      ${origin.hostname}`,
    `// @downloadURL  ${base}/__monkey.user.js`,
    `// @updateURL    ${base}/__monkey.user.js`,
  ]) + `
(() => {
  'use strict';
  if (window.top !== window.self) return;
  const base = ${JSON.stringify(base)};
  let revision, running = false, warned = false;
  const request = path => new Promise((resolve, reject) => {
    GM_xmlhttpRequest({method: 'GET', url: base + path, timeout: 5000,
      onload: response => response.status === 200 ? resolve(JSON.parse(response.responseText)) : reject(new Error('HTTP ' + response.status)),
      onerror: () => reject(new Error('开发服务不可达')), ontimeout: () => reject(new Error('开发服务超时'))});
  });
  async function tick() {
    try {
      if (!running) {
        const payload = await request('/__readscape/bundle');
        new Function('GM_registerMenuCommand', payload.code)(GM_registerMenuCommand);
        revision = payload.revision;
        running = true;
        console.info('[readscape dev] 已加载', revision);
      } else {
        const next = await request('/__readscape/revision');
        if (next.revision !== revision) { location.reload(); return; }
      }
      warned = false;
    } catch (error) {
      if (!warned) console.warn('[readscape dev]', error);
      warned = true;
    }
    setTimeout(tick, 1500);
  }
  tick();
})();
`;
}
function release() {
  const path = `/readscape-${id}.user.js`;
  return header([`// @downloadURL  ${base}${path}`, `// @updateURL    ${base}${path}`]) + bundle.slice(bundle.indexOf('// ==/UserScript==') + '// ==/UserScript=='.length);
}
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>阅境开发服务</title>
<style>body{max-width:680px;margin:70px auto;padding:24px;font:16px/1.8 system-ui;color:#242424;background:#f7f7fa}a{color:#c92346}h1{font-size:30px}section{background:white;border-radius:20px;padding:24px;margin:20px 0}code{background:#eee;padding:3px 6px;border-radius:5px}</style>
<h1>阅境开发服务</h1><section><h2>开发联调</h2><p><a href="/__monkey.user.js">安装 / 更新开发脚本</a></p><p>安装后打开 NGA 页面。保存 src 下的源码或样式后，页面会自动刷新并加载最新代码。开发期间保持此服务运行。</p></section>
<section><h2>正式使用</h2><p><a href="/readscape-${id}.user.js">安装 / 更新正式脚本</a></p><p>正式脚本安装后可独立运行。同名脚本会替换开发脚本，保留已有设置和收藏。</p></section></html>`;
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const send = (status, type, body) => {
    res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'text/plain', 'Method not allowed');
  if (path === '/') return send(200, 'text/html', html);
  if (buildError) return send(503, 'text/plain', '源码构建失败，请查看开发服务器终端。');
  if (path === '/__monkey.user.js') return send(200, 'application/javascript', loader());
  if (path === `/readscape-${id}.user.js`) return send(200, 'application/javascript', release());
  if (path === '/__readscape/bundle') return send(200, 'application/json', JSON.stringify({ revision, code: bundle }));
  if (path === '/__readscape/revision') return send(200, 'application/json', JSON.stringify({ revision }));
  send(404, 'text/plain', 'Not found');
});
let debounce;
const changed = () => { clearTimeout(debounce); debounce = setTimeout(build, 150); };
const watchers = [watch(resolve(root, 'src'), { recursive: true }, changed), watch(resolve(root, 'package.json'), changed)];
server.on('error', error => { console.error(`开发服务启动失败: ${error.message}`); process.exit(1); });
server.listen(port, host, () => {
  console.log(`开发网页: ${base}/\n安装开发脚本: ${base}/__monkey.user.js\n监听: ${host}:${port}（Ctrl-C 停止）`);
});
function stop() { clearTimeout(debounce); watchers.forEach(w => w.close()); server.close(); }
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
