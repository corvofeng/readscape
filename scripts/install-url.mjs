#!/usr/bin/env node
// 打印（并可选打开）油猴脚本的公开安装地址。
// 公开仓库使用 raw.githubusercontent.com 直链，无需任何凭据即可在油猴中安装与更新。
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = { owner: 'corvofeng', name: 'readscape', branch: 'dist' };
const ids = readdirSync(resolve(root, 'src/adapters'), { withFileTypes: true })
  .filter(d => d.isDirectory()).map(d => d.name);
const requested = process.argv[2];
if (requested && !ids.includes(requested)) throw new Error(`未知适配器: ${requested}`);
const targets = requested ? [requested] : ids;

// 公开仓库使用标准的 raw.githubusercontent.com 地址，无需任何凭据。
// 如需私有测试，可通过显式环境变量 READSCAPE_UPDATE_TOKEN 传入。
const token = process.env.READSCAPE_UPDATE_TOKEN?.trim() || '';
const base = process.env.READSCAPE_UPDATE_BASE
  || `https://${token ? `${token}@` : ''}raw.githubusercontent.com/${repo.owner}/${repo.name}/${repo.branch}`;

console.log(`仓库: ${repo.owner}/${repo.name}（分支 ${repo.branch}）\n`);
const mirrorBase = (process.env.R2_PUBLIC_BASE || 'https://rawforcorvofeng.cn').replace(/\/$/, '');
for (const id of targets) {
  const url = `${base.replace(/\/$/, '')}/readscape-${id}.user.js`;
  console.log(`阅境 · ${id}`);
  console.log(`  安装/更新地址: ${url}`);
  console.log(`  备用镜像地址: ${mirrorBase}/readscape/readscape-${id}.user.js`);
  if (process.platform === 'darwin' && process.env.READSCAPE_OPEN === '1') {
    try { execFileSync('open', [url]); console.log('  已在浏览器打开（在油猴中确认安装）'); } catch {}
  }
  console.log('');
}
console.log('把上面的地址粘贴到浏览器地址栏（或直接点击链接）即可触发油猴安装；');
console.log('安装后油猴会记住脚本内的 @updateURL/@downloadURL，后续发布新版本时自动检查更新。');
console.log('也可用: READSCAPE_OPEN=1 npm run install-url 直接打开。');
