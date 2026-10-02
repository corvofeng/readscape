const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const script = (version, fixed) => `// @version      ${version}\n// @updateURL    ${fixed ? 'none' : 'https://example.com/latest.user.js'}\n// @downloadURL  ${fixed ? 'none' : 'https://example.com/latest.user.js'}\nconsole.log('${version}');\n`;

test('fixed builds contain no credentials or automatic update endpoint and share the latest script body', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readscape-fixed-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(repo, 'src'), path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(path.join(repo, 'scripts/build.mjs'), path.join(root, 'scripts/build.mjs'));
  fs.copyFileSync(path.join(repo, 'package.json'), path.join(root, 'package.json'));
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
  const env = { ...process.env, READSCAPE_UPDATE_TOKEN: 'test-only-credential', READSCAPE_UPDATE_BASE: 'https://example.com/latest' };
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, env });
  execFileSync(process.execPath, ['scripts/build.mjs', '--fixed'], { cwd: root, env });
  const latest = fs.readFileSync(path.join(root, 'dist/readscape-nga.user.js'), 'utf8');
  const fixed = fs.readFileSync(path.join(root, `dist/v${version}/readscape-nga.user.js`), 'utf8');
  assert.match(latest, /test-only-credential/);
  assert(!fixed.includes('test-only-credential')); assert(!fixed.includes('https://example.com/latest'));
  assert.match(fixed, /^\/\/ @downloadURL\s+none$/m);
  const stripUpdates = text => text.replace(/^\/\/ @(?:updateURL|downloadURL).*$/gm, '');
  assert.equal(stripUpdates(latest), stripUpdates(fixed));
});

test('publishing preserves fixed versions, rejects overwrites, and does not downgrade latest when backfilling', async t => {
  const { publishArtifacts } = await import('../scripts/publish-dist.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readscape-publish-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'published'), source = path.join(root, 'build');
  const file = 'readscape-nga.user.js';
  function prepare(version) {
    fs.mkdirSync(path.join(source, `v${version}`), { recursive: true });
    fs.writeFileSync(path.join(source, file), script(version, false));
    fs.writeFileSync(path.join(source, `v${version}`, file), script(version, true));
  }
  prepare('3.0.2'); publishArtifacts(target, source, 'v3.0.2');
  const original = fs.readFileSync(path.join(target, 'v3.0.2', file));
  prepare('3.0.3'); publishArtifacts(target, source, 'v3.0.3');
  publishArtifacts(target, source, 'v3.0.3'); // Safe retry.
  prepare('3.0.1'); publishArtifacts(target, source, 'v3.0.1');
  assert.equal(fs.readFileSync(path.join(target, file), 'utf8'), script('3.0.3', false));
  assert.deepEqual(fs.readFileSync(path.join(target, 'v3.0.2', file)), original);
  prepare('3.0.2');
  fs.appendFileSync(path.join(source, file), '// Changed code\n');
  fs.appendFileSync(path.join(source, 'v3.0.2', file), '// Changed code\n');
  assert.throws(() => publishArtifacts(target, source, 'v3.0.2'), /immutable/);
  assert.equal(fs.readFileSync(path.join(target, file), 'utf8'), script('3.0.3', false));
  assert.deepEqual(fs.readFileSync(path.join(target, 'v3.0.2', file)), original);
  assert.throws(() => publishArtifacts(target, source, 'v3.0.4'), /ENOENT|versions differ/);
});
