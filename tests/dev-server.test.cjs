const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const vm = require('node:vm');
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('development HTTP install, rebuild, build failure and recovery', { timeout: 20000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readscape-dev-test-'));
  const repo = path.resolve(__dirname, '..');
  fs.cpSync(path.join(repo, 'src'), path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'));
  for (const file of ['build.mjs', 'dev-server.mjs']) fs.copyFileSync(path.join(repo, 'scripts', file), path.join(root, 'scripts', file));
  fs.copyFileSync(path.join(repo, 'package.json'), path.join(root, 'package.json'));
  const socket = net.createServer();
  await new Promise(r => socket.listen(0, '127.0.0.1', r));
  const port = socket.address().port;
  await new Promise(r => socket.close(r));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['scripts/dev-server.mjs', '--host', '127.0.0.1', '--port', String(port), '--origin', base], { cwd: root });
  let output = '';
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => output += data);
  t.after(async () => {
    if (child.exitCode === null) {
      const ended = new Promise(r => child.once('exit', r));
      child.kill('SIGTERM');
      await ended;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function until(fn) {
    for (let i = 0; i < 80; i++) { if (await fn()) return; await sleep(100); }
    throw new Error('Condition timed out: ' + output);
  }
  await until(() => output.includes('安装开发脚本:'));
  const fetchPath = p => fetch(base + p, { signal: AbortSignal.timeout(2000) });
  assert.match(await (await fetchPath('/')).text(), /安装 \/ 更新开发脚本/);
  const response = await fetchPath('/__monkey.user.js');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const loader = await response.text();
  new vm.Script(loader);
  assert.match(loader, /@connect\s+127\.0\.0\.1/);
  assert.ok(loader.includes(`// @downloadURL  ${base}/__monkey.user.js`));
  const installed = [];
  const timers = [];
  let reloads = 0;
  let liveRevision = 'first';
  const window = {}; window.top = window; window.self = window;
  const sandbox = {
    window, console: { info() {}, warn() {} },
    location: { reload() { reloads++; } },
    GM_registerMenuCommand: label => installed.push(label),
    GM_xmlhttpRequest: options => options.onload({ status: 200, responseText: JSON.stringify({ revision: liveRevision, code: 'GM_registerMenuCommand("loaded");' }) }),
    setTimeout: callback => timers.push(callback),
  };
  vm.runInNewContext(loader, sandbox);
  await sleep(0);
  assert.deepEqual(installed, ['loaded']);
  liveRevision = 'second';
  await timers.shift()();
  assert.equal(reloads, 1);
  const release = await (await fetchPath('/readscape-nga.user.js')).text();
  assert.ok(release.includes(`// @updateURL    ${base}/readscape-nga.user.js`));
  assert.ok(release.includes('// @grant        GM_xmlhttpRequest'));
  assert.ok(release.includes('// @connect      img.nga.cn'));
  assert.ok(!release.includes(`// @connect      ${new URL(base).hostname}`),'正式版只连接图片服务，不包含开发服务的权限');
  assert.equal((await fetchPath('/package.json')).status, 404);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  const before = await (await fetchPath('/__readscape/bundle')).json();
  const filename = path.join(root, 'src/adapters/nga/index.js');
  const source = fs.readFileSync(filename, 'utf8');
  fs.writeFileSync(filename, source + '\n// dev server test change\n');
  await until(async () => {
    const r = await fetchPath('/__readscape/revision');
    return r.ok && (await r.json()).revision !== before.revision;
  });
  const next = await (await fetchPath('/__readscape/bundle')).json();
  assert.match(next.code, /dev server test change/);
  fs.writeFileSync(filename, source + '\nconst = broken;\n');
  await until(async () => (await fetchPath('/__readscape/revision')).status === 503);
  fs.writeFileSync(filename, source);
  await until(async () => (await fetchPath('/__readscape/revision')).status === 200);
  assert.equal((await (await fetchPath('/__readscape/revision')).json()).revision, before.revision);
});
