import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const versionOf = code => code.match(/^\/\/ @version\s+(\d+\.\d+\.\d+)$/m)?.[1];
function compareVersions(a, b) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

export function publishArtifacts(target, source, tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Expected a release tag such as v3.0.3');
  const files = readdirSync(source).filter(file => /^readscape-[\w-]+\.user\.js$/.test(file)).sort();
  if (!files.length) throw new Error('No userscripts to publish');
  const archive = resolve(target, tag), fixedSource = resolve(source, tag);
  const fixedFiles = readdirSync(fixedSource).sort();
  if (JSON.stringify(files) !== JSON.stringify(fixedFiles)) throw new Error('Fixed and latest adapters differ');
  const existingFiles = existsSync(archive) ? readdirSync(archive).sort() : null;
  if (existingFiles && JSON.stringify(files) !== JSON.stringify(existingFiles)) throw new Error(`Cannot change immutable release ${tag}`);
  const staged = files.map(file => {
    const latest = readFileSync(resolve(source, file), 'utf8');
    const fixed = readFileSync(resolve(fixedSource, file), 'utf8');
    if (versionOf(latest) !== tag.slice(1) || versionOf(fixed) !== tag.slice(1)) throw new Error('Tag and userscript versions differ');
    if (!/^\/\/ @updateURL\s+none$/m.test(fixed) || !/^\/\/ @downloadURL\s+none$/m.test(fixed)) throw new Error('Fixed scripts must disable updates');
    const stripUpdates = code => code.replace(/^\/\/ @(?:updateURL|downloadURL).*$/gm, '');
    if (stripUpdates(latest) !== stripUpdates(fixed)) throw new Error('Fixed and latest script bodies differ');
    if (existingFiles && readFileSync(resolve(archive, file), 'utf8') !== fixed) throw new Error(`Cannot overwrite immutable release ${tag}/${file}`);
    const current = resolve(target, file);
    const currentVersion = existsSync(current) ? versionOf(readFileSync(current, 'utf8')) : null;
    if (existsSync(current) && !currentVersion) throw new Error(`Cannot determine current version of ${file}`);
    return { file, latest, fixed, updateLatest: !currentVersion || compareVersions(tag.slice(1), currentVersion) >= 0 };
  });
  mkdirSync(archive, { recursive: true });
  for (const { file, latest, fixed, updateLatest } of staged) {
    if (!existingFiles) writeFileSync(resolve(archive, file), fixed);
    if (updateLatest) writeFileSync(resolve(target, file), latest);
  }
  console.log(`Published ${tag}; previous release directories preserved`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [target, source, tag] = process.argv.slice(2);
  if (!target || !source || !tag) throw new Error('Usage: node scripts/publish-dist.mjs TARGET SOURCE TAG');
  publishArtifacts(resolve(target), resolve(source), tag);
}
