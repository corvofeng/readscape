import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root,path),'utf8');
const pkg = JSON.parse(read('package.json'));
const requested = process.argv[2];
const ids = readdirSync(resolve(root,'src/adapters'),{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
if (requested && !ids.includes(requested)) throw new Error(`Unknown adapter: ${requested}`);
mkdirSync(resolve(root,'dist'),{recursive:true});
for (const id of requested ? [requested] : ids) {
  const directory = `src/adapters/${id}`;
  const m = JSON.parse(read(`${directory}/manifest.json`));
  if (!m.hosts.length || !m.paths.length || m.id !== id) throw new Error(`Invalid manifest: ${id}`);
  let adapter = read(`${directory}/index.js`);
  for (const [marker,file] of Object.entries(m.modules || {})) adapter = adapter.replace(`/* ${marker} */`,read(`${directory}/${file}`));
  for (const [marker,file] of Object.entries(m.styles || {})) adapter = adapter.replace(`/* ${marker} */`,JSON.stringify(read(`${directory}/${file}`)));
  if (/\/\* (?:\w+_CSS|\w+_MODULE) \*\//.test(adapter)) throw new Error(`Unresolved module in ${id}`);
  const matches = m.hosts.flatMap(host=>m.paths.map(path=>`// @match        https://${host}${path}*`));
  const header = ['// ==UserScript==',`// @name         ${m.name}`,`// @namespace    ${m.namespace}`,`// @version      ${pkg.version}`,`// @description  ${m.description}`,...matches,'// @run-at       document-start','// @grant        GM_registerMenuCommand','// @grant        unsafeWindow','// @grant        GM_xmlhttpRequest','// @connect      img.nga.cn','// @connect      img2.nga.cn','// @connect      img3.nga.cn','// @connect      img4.nga.cn','// @connect      img.nga.178.com','// @license      MIT','// ==/UserScript=='].join('\n');
  const config = JSON.stringify({storageKey:m.storageKey,hosts:m.hosts,paths:m.paths});
  const output = `${header}\n\n(() => {\n'use strict';\nif (window.top !== window.self) return;\n${read('src/core/post-cache.js')}\n${read('src/core/navigation.js')}\n${read('src/core/settings.js')}\n${adapter}\nconst config = ${config};\nconfig.accepts = u => config.hosts.includes(u.hostname) && config.paths.includes(u.pathname);\nconst postCache = createPostCache({ context: window, key: config.storageKey });\nconfig.mountReader = context => { const navigation = createNavigation(config, context); try { runAdapter({ navigation, context, postCache }); } catch (error) { navigation.destroy(); throw error; } return () => { context.dispatchEvent(new context.PageTransitionEvent('pagehide')); navigation.destroy(); }; };\nconst navigation = createNavigation(config);\nconst start = () => { if (!config.accepts(new URL(location.href))) { navigation.finish(); return; } try { runAdapter({ navigation, postCache }); } catch (error) { navigation.finish(); console.error('[readscape]', error); } };\nif (document.body && document.head) start();\nelse document.addEventListener('DOMContentLoaded', start, {once:true});\n})();\n`;
  new vm.Script(output,{filename:`${id}.user.js`});
  const filename = `readscape-${id}.user.js`;
  writeFileSync(resolve(root,'dist',filename),output);
  console.log(`Built ${filename} (${m.category})`);
}
