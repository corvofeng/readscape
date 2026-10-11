#!/usr/bin/env node
// 把构建产物同步到博客 Cloudflare R2 镜像（https://rawforcorvofeng.cn/）。
// 桶 blog 的根目录直接映射到该域名，产物放在独立前缀（默认 readscape/）下，
// 作为 GitHub raw 不可达时的备用安装与自动更新源。
//
// 上传走 S3 兼容 API（SigV4 签名），零依赖。
//
// 凭证解析优先级：--env-file 文件内变量 > AWS_* 标准变量 > R2_* 备用变量 > 默认值。
// （CI 里用 R2_* secrets 即可；本地 shell 若混入过其他 R2_* 环境变量也不会盖掉 --env-file。）
//   AWS_ACCESS_KEY_ID | R2_ACCESS_KEY_ID            必填
//   AWS_SECRET_ACCESS_KEY | R2_SECRET_ACCESS_KEY    必填
//   AWS_ENDPOINT_URL | R2_ENDPOINT                  必填（https://<account>.r2.cloudflarestorage.com）
//   R2_BUCKET                                       必填（本博客为 blog，已写入 ~/.env.r2-blog）
//   AWS_DEFAULT_REGION | R2_REGION                  选填，默认 auto
//   R2_PUBLIC_BASE                                  选填，默认 https://rawforcorvofeng.cn
//
// 用法示例：
//   npm run publish:r2 -- --env-file ~/.env.r2-blog --with-archive --check   # 本地一键：读文件上传并回读校验
//   npm run publish:r2                                                        # 上传 dist/ 到 readscape/
//   npm run publish:r2 -- --set dist=readscape --set dist/v3.0.6=readscape/v3.0.6
//
// 提示：要让镜像上的脚本更新也走 R2，先以
//   READSCAPE_UPDATE_BASE=https://rawforcorvofeng.cn/readscape npm run build
// 构建再上传；CI 发布标签时会自动这样处理。
import { createHash, createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

function parseArgs() {
  const flags = new Set();
  const sets = [];
  const positions = [];
  let envFile = '';
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--set') {
      const value = args[index += 1];
      if (value === undefined || value.startsWith('--')) throw new Error('--set expects LOCAL_DIR=REMOTE_PREFIX');
      sets.push(value);
    } else if (arg.startsWith('--set=')) sets.push(arg.slice(6));
    else if (arg === '--env-file') {
      envFile = args[index += 1];
      if (envFile === undefined || envFile.startsWith('--')) throw new Error('--env-file expects a path');
    } else if (arg.startsWith('--env-file=')) envFile = arg.slice(11);
    else if (arg === '--check' || arg === '--with-archive') flags.add(arg);
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}（可用：--env-file、--set、--with-archive、--check）`);
    else positions.push(arg);
  }
  if (positions.length) throw new Error(`Unexpected arguments: ${positions.join(' ')}`);
  // 默认：最新产物 dist/ -> readscape/；--with-archive 追加固定版 dist/vX -> readscape/vX。
  const mappings = sets.length
    ? sets
    : flags.has('--with-archive')
      ? ['dist=readscape', `dist/v${pkg.version}=readscape/v${pkg.version}`]
      : ['dist=readscape'];
  for (const mapping of mappings) {
    if (!mapping.includes('=')) throw new Error(`--set expects LOCAL_DIR=REMOTE_PREFIX, got: ${mapping}`);
  }
  return { mappings, check: flags.has('--check'), envFile };
}

// 读取 export KEY="value" / KEY=value 形式的环境文件，作为最高优先级凭证来源。
function loadEnvFile(file) {
  const path = file.startsWith('~') ? resolve(process.env.HOME || '~', file.slice(2)) : resolve(file);
  const values = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!match || match[1] === undefined) continue;
    values[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return values;
}

const sha256Hex = data => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

async function putObject({ accessKeyId, secretAccessKey, endpoint, bucket, region, publicBase }, key, body) {
  const { host, protocol } = new URL(endpoint);
  const path = `/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers = {
    'cache-control': 'public, max-age=300',
    'content-type': 'text/javascript; charset=utf-8',
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map(name => `${name}:${String(headers[name]).trim()}\n`).join('');
  const canonicalRequest = ['PUT', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const response = await fetch(`${protocol}//${host}${path}`, {
    method: 'PUT',
    body,
    headers: { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` },
  });
  if (!response.ok) throw new Error(`PUT ${key} failed: ${response.status} ${await response.text()}`);
  return `${publicBase}/${key}`;
}

async function main() {
  const { mappings, check, envFile } = parseArgs();
  const fileVars = envFile ? loadEnvFile(envFile) : {};
  const env = process.env;
  // --env-file 的值优先于进程环境，进程环境里 AWS_* 标准名优先于 R2_* 备用名。
  const pick = (...names) => {
    for (const name of names) if (fileVars[name]) return fileVars[name];
    for (const name of names) if (env[name]) return env[name];
    return '';
  };
  const config = {
    accessKeyId: pick('AWS_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID'),
    secretAccessKey: pick('AWS_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY'),
    endpoint: pick('AWS_ENDPOINT_URL', 'R2_ENDPOINT'),
    bucket: pick('R2_BUCKET', 'AWS_BUCKET'),
    region: pick('AWS_DEFAULT_REGION', 'R2_REGION') || 'auto',
    publicBase: (pick('R2_PUBLIC_BASE') || 'https://rawforcorvofeng.cn').replace(/\/$/, ''),
  };
  if (!config.accessKeyId || !config.secretAccessKey || !config.endpoint || !config.bucket) {
    throw new Error('Missing credentials: need AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_ENDPOINT_URL + R2_BUCKET（或 R2_* 同名变量）；本地推荐直接加 --env-file ~/.env.r2-blog');
  }
  const uploads = [];
  for (const mapping of mappings) {
    const [local, remote] = mapping.split('=');
    if (remote.split('/').some(part => part === '..' || part === '')) throw new Error(`Invalid remote prefix: ${remote}`);
    const directory = resolve(root, local);
    const files = readdirSync(directory).filter(file => /^readscape-[\w-]+\.user\.js$/.test(file)).sort();
    if (!files.length) throw new Error(`No userscripts found in ${local}`);
    for (const file of files) uploads.push({ key: `${remote}/${file}`, body: readFileSync(resolve(directory, file)) });
  }
  const urls = [];
  for (const { key, body } of uploads) {
    const url = await putObject(config, key, body);
    console.log(`Uploaded ${key} (${body.length} bytes) -> ${url}`);
    urls.push({ url, key, body });
  }
  if (check) {
    for (const { url, body } of urls) {
      const version = body.toString('utf8').match(/^\/\/ @version\s+(\d+\.\d+\.\d+)$/m)?.[1];
      // 带时间戳绕开边缘缓存，确认对象已公开可读且版本一致。
      const response = await fetch(`${url}?ts=${Date.now()}`);
      const remoteText = await response.text();
      const remoteVersion = remoteText.match(/^\/\/ @version\s+(\d+\.\d+\.\d+)$/m)?.[1];
      if (!response.ok || remoteVersion !== version) throw new Error(`Verify failed for ${url}: status ${response.status}, version ${remoteVersion} != ${version}`);
      console.log(`Verified ${basename(url)} v${remoteVersion} is publicly reachable`);
    }
  }
  console.log('\n镜像安装地址：');
  for (const { url, key } of urls) if (!key.includes('/v')) console.log(`  ${url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`publish-r2: ${error.message}`); process.exit(1); });
}
