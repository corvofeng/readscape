#!/usr/bin/env node
// 打印（并可选打开）私有仓库的油猴安装地址。
// 私有仓库的 raw 文件需要 token 才能拉取；把 token 内嵌到 URL userinfo，
// 油猴即可在不带凭证的情况下完成首次安装与后续自动更新。
// token 从环境变量或本机 gh CLI 读取，绝不写入仓库文件。
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

function readToken() {
  if (process.env.READSCAPE_UPDATE_TOKEN) return process.env.READSCAPE_UPDATE_TOKEN.trim();
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const token = readToken();
const base = process.env.READSCAPE_UPDATE_BASE
  || `https://${token ? `${token}@` : ''}raw.githubusercontent.com/${repo.owner}/${repo.name}/${repo.branch}`;

if (!token) {
  console.error('提示: 未找到 token（READSCAPE_UPDATE_TOKEN / GH_TOKEN / gh auth token）。');
  console.error('私有仓库需要 token 才能安装与自动更新；下面的地址不含 token，可能返回 404。\n');
}

console.log(`仓库: ${repo.owner}/${repo.name}（分支 ${repo.branch}，私有需 token）\n`);
for (const id of targets) {
  const url = `${base.replace(/\/$/, '')}/readscape-${id}.user.js`;
  console.log(`阅境 · ${id}`);
  console.log(`  安装/更新地址: ${url}`);
  if (process.platform === 'darwin' && process.env.READSCAPE_OPEN === '1') {
    try { execFileSync('open', [url]); console.log('  已在浏览器打开（在油猴中确认安装）'); } catch {}
  }
  console.log('');
}
console.log('把上面的地址粘贴到浏览器地址栏即可触发油猴安装；');
console.log('安装后油猴会记住脚本内的 @updateURL/@downloadURL（已含 token），后续自动检查更新。');
console.log('也可用: READSCAPE_OPEN=1 npm run install-url 直接打开。');
