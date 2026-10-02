// ==UserScript==
// @name         阅境 · NGA
// @namespace    nga-cards-local
// @version      3.0.0
// @description  阅境（Readscape）的 NGA 阅读适配器：卡片列表、正文与回复阅读、字体配色设置、手机布局和原生跳转过渡。
// @homepageURL  https://github.com/corvofeng/readscape
// @supportURL   https://github.com/corvofeng/readscape/issues
// @match        https://bbs.nga.cn/thread.php*
// @match        https://bbs.nga.cn/read.php*
// @match        https://nga.178.com/thread.php*
// @match        https://nga.178.com/read.php*
// @match        https://ngabbs.com/thread.php*
// @match        https://ngabbs.com/read.php*
// @match        https://bbs.ngacn.cc/thread.php*
// @match        https://bbs.ngacn.cc/read.php*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @updateURL    none
// @downloadURL  none
// @license      MIT
// ==/UserScript==

(() => {
'use strict';
if (window.top !== window.self) return;
function createPostCache({ context = globalThis.window, key, maxPosts = 500, maxMetadataBytes = 10 * 1024 * 1024, ttl = 7 * 86400000 }) {
  const stores = ['posts', 'replyPages', 'relations', 'listPages'];
  const listeners = new Set();
  let connection, queue = Promise.resolve(), closed = false, epoch = 0;
  let enabled = true, postLimit = maxPosts;
  const channel = typeof context.BroadcastChannel === 'function' ? new context.BroadcastChannel(`${key}-cache-events`) : null;
  const validTid = tid => /^\d+$/.test(String(tid));
  const size = value => JSON.stringify(value).length * 2;
  const resourceId = source => { try { const u = new URL(source); if (!/^https?:$/.test(u.protocol)) return null; u.hash = ''; return u.href; } catch { return null; } };
  const notify = event => { for (const listener of listeners) { try { listener(event); } catch {} } if (!event.remote) { try { channel?.postMessage(event); } catch {} } };
  // 封面登记先同步写一条 pending 日志：页面在 IndexedDB 写入提交前被刷新/关闭时，
  // 下次加载据此回填，避免"关系没存上、刷新后封面消失"。
  const pendingCoverKey = `${key}-cover-pending`;
  const readPendingCovers = () => { try { return JSON.parse(context.localStorage.getItem(pendingCoverKey) || '{}') || {}; } catch { return {}; } };
  const writePendingCovers = map => { try { if (Object.keys(map).length) context.localStorage.setItem(pendingCoverKey, JSON.stringify(map)); else context.localStorage.removeItem(pendingCoverKey); } catch {} };
  const dropPendingCover = tid => { const map = readPendingCovers(); if (!(tid in map)) return; delete map[tid]; writePendingCovers(map); };
  // 只在本会话结束前把"已登记但还没提交"的封面同步落一条 pending 日志，
  // 避免与本次会话自己的 IndexedDB 写入竞争。
  const uncommittedCovers = new Map();
  const flushPendingCovers = () => { if (!uncommittedCovers.size) return; const map = readPendingCovers(); for (const [tid, source] of uncommittedCovers) map[tid] = { source, at: Date.now() }; writePendingCovers(map); };
  if (channel) channel.onmessage = message => { const event=message.data;if(!event||!['clear','usage','favorites','evict','cover'].includes(event.type))return;if(event.type==='clear')epoch++;notify({...event,remote:true}); };
  function database() {
    return connection ||= new Promise(resolve => {
      if (!context.indexedDB || closed) { resolve(null); return; }
      try {
        const request = context.indexedDB.open(`${key}-posts`, 3);
        request.onupgradeneeded = () => {
          const db = request.result, tx = request.transaction;
          for (const [name, keyPath] of [['posts','tid'],['replyPages',['tid','page']],['relations','id'],['listPages','id']]) {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
          }
          for (const [name, indexes] of [['posts',['lastAccess']],['replyPages',['tid']],['relations',['tid','kind']],['listPages',['streamKey']]]) {
            const store = tx.objectStore(name);
            for (const index of indexes) if (!store.indexNames.contains(index)) store.createIndex(index, index);
          }
          // Version 1 keyed each cover by thread and stored bytes; version 3 keeps
          // only the cover URL, so drop the blob stores and legacy image links.
          if (db.objectStoreNames.contains('images')) {
            const cursor = tx.objectStore('images').openCursor();
            cursor.onsuccess = () => {
              const row = cursor.result;
              if (!row) { db.deleteObjectStore('images'); return; }
              const image = row.value, id = resourceId(image?.source);
              if (id && image.tid != null) {
                const post = tx.objectStore('posts').get(image.tid);
                post.onsuccess = () => { if (post.result && !post.result.coverId) tx.objectStore('posts').put({ ...post.result, coverId: id }); };
              }
              row.continue();
            };
          }
          if (db.objectStoreNames.contains('resources')) db.deleteObjectStore('resources');
          const relations = tx.objectStore('relations').openCursor();
          relations.onsuccess = () => { const row = relations.result; if (!row) return; if (row.value?.kind === 'image') row.delete(); row.continue(); };
        };
        request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); resolve(db); };
        request.onerror = request.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  function enqueue(operation) {
    const result = queue.then(operation).catch(() => null); queue = result; return result;
  }
  function readModel(tx, done) {
    const model = {}, original = {}; let left = stores.length;
    const finish = (name, rows) => {
      const identity = name === 'posts' ? p => p.tid : name === 'replyPages' ? p => `${p.tid}:${p.page}` : p => p.id;
      original[name] = new Map(rows.map(p => [identity(p), p]));
      model[name] = new Map(rows.map(p => [identity(p), { ...p }]));
      if (!--left) done(model, original);
    };
    for (const name of stores) { const request = tx.objectStore(name).getAll(); request.onsuccess = () => finish(name, request.result); }
  }
  function removePost(model, tid) {
    model.posts.delete(tid);
    for (const [id, row] of model.replyPages) if (row.tid === tid) model.replyPages.delete(id);
    for (const [id, row] of model.listPages) {
      row.tids = row.tids.filter(t => t !== tid); if (!row.tids.length) model.listPages.delete(id);
    }
  }
  function usage(model, sizes = new WeakMap()) {
    const bytes = row => { if (!sizes.has(row)) sizes.set(row,size(row)); return sizes.get(row); };
    const metadataBytes = ['posts','replyPages'].reduce((sum, name) => sum + [...model[name].values()].reduce((n, row) => n + bytes(row), 0), 0) + [...model.listPages.values()].reduce((n,row)=>n+size(row),0) +
      [...model.relations.values()].filter(r => r.kind !== 'favorite').reduce((n, row) => n + bytes(row), 0);
    return { available: true, posts: model.posts.size, replyPages: model.replyPages.size, metadataBytes, totalBytes: metadataBytes, favorites: [...model.relations.values()].filter(r => r.kind === 'favorite').length, enabled, maxPosts: postLimit, maxMetadataBytes };
  }
  function prune(model) {
    const now = Date.now();
    for (const p of model.posts.values()) if (now - p.lastAccess > ttl) removePost(model, p.tid);
    const sizes = new WeakMap();
    for (const p of [...model.posts.values()].sort((a,b) => a.lastAccess - b.lastAccess)) {
      const used = usage(model,sizes);
      if (used.posts <= postLimit && used.metadataBytes <= maxMetadataBytes) break;
      removePost(model, p.tid);
    }
  }
  async function mutate(change, generation = epoch) {
    const db = await database(); if (!db || closed || generation !== epoch) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite'); let result, removed = [], changed = false;
      readModel(tx, (model, original) => {
        try {
          result = change(model); prune(model);
          removed = [...original.posts.keys()].filter(tid => !model.posts.has(tid));
          for (const name of stores) {
            const store = tx.objectStore(name);
            for (const [id, row] of original[name]) if (!model[name].has(id)) { store.delete(name === 'replyPages' ? [row.tid,row.page] : id); changed = true; }
            for (const [id, row] of model[name]) if (JSON.stringify(row) !== JSON.stringify(original[name].get(id))) { store.put(row); changed = true; }
          }
        } catch (error) { tx.abort(); reject(error); }
      });
      tx.oncomplete = () => { if (removed.length) notify({ type:'evict', tids:removed }); if (changed) notify({ type:'usage' }); resolve(result); };
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('缓存写入失败'));
    });
  }
  function remember(model, item, at = Date.now()) {
    if (!item || !validTid(item.tid)) return;
    const tid = String(item.tid); let previous = model.posts.get(tid);
    if (previous && at - previous.lastAccess > ttl) { removePost(model, tid); previous = null; }
    model.posts.set(tid, { ...previous, ...item, tid, lastAccess: at, updatedAt: item.updatedAt ?? previous?.updatedAt ?? at });
  }
  const ready = database().then(async db => {
    if (!db) return false;
    let pages = [], favorites = {};
    try { const raw = context.localStorage.getItem(`${key}-list-cache`); if (raw && raw.length * 2 <= maxMetadataBytes) pages = JSON.parse(raw)?.pages || []; } catch {}
    try { favorites = JSON.parse(context.localStorage.getItem(`${key}-favorites`) || '{}'); } catch {}
    const pendingCovers = readPendingCovers(), appliedCovers = [];
    const migrated = await mutate(model => {
      for (const page of Array.isArray(pages) ? pages : []) {
        const items = (Array.isArray(page?.items) ? page.items : []).filter(item => validTid(item?.tid) && Date.now() - (item.lastAccess ?? page.at ?? 0) <= ttl);
        if (!items.length || !page.key || !Number.isInteger(page.number)) continue;
        for (const item of items) if (!model.posts.has(String(item.tid))) remember(model, item, item.lastAccess ?? page.at);
        const id = `${page.key}#${page.number}`;
        if (!model.listPages.has(id)) model.listPages.set(id, { id, streamKey:page.key, number:page.number, url:page.url, next:page.next, tids:items.map(i=>String(i.tid)), cachedAt:page.at });
      }
      for (const item of Object.values(favorites || {})) if (validTid(item?.tid)) {
        const tid = String(item.tid), id = `favorite:${tid}`;
        if (!model.relations.has(id)) model.relations.set(id, { id, kind:'favorite', tid, savedAt:Date.now(), snapshot:item });
      }
      for (const [tid, entry] of Object.entries(pendingCovers)) {
        const id = resourceId(entry?.source); if (!id || !validTid(tid)) continue;
        remember(model, { tid }); const post = model.posts.get(tid);
        if (post) { post.coverId = id; appliedCovers.push(tid); }
      }
      return true;
    });
    if (migrated) for (const tid of appliedCovers) dropPendingCover(tid);
    if (migrated) { try { context.localStorage.removeItem(`${key}-list-cache`); context.localStorage.removeItem(`${key}-favorites`); } catch {} }
    return !!migrated;
  }).catch(() => false);
  function write(change) {
    const generation = epoch;
    return enqueue(async () => { if (!await ready || !enabled || generation !== epoch) return null; return mutate(change, generation); });
  }
  async function read(select, includeDisabled = false) {
    if (!await ready) return null; await queue; const db = await database(); if (!db || closed || !enabled && !includeDisabled) return null;
    return new Promise(resolve => {
      const tx = db.transaction(stores, 'readonly'); let result;
      readModel(tx, model => { prune(model); result = select(model); });
      tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => resolve(null);
    });
  }
  function visit(input) {
    const items = Array.isArray(input) ? input : [input]; if (!items.length) return Promise.resolve(true);
    return write(model => { for (const item of items) remember(model, item); return true; });
  }
  async function getRecord(name,id) {
    if(!await ready)return null; await queue; const db=await database(); if(!db||closed||!enabled)return null;
    return new Promise(resolve=>{const tx=db.transaction(name),request=tx.objectStore(name).get(id);tx.oncomplete=()=>resolve(request.result||null);tx.onerror=tx.onabort=()=>resolve(null);});
  }
  const getPost = async tid => {const post=await getRecord('posts',String(tid));return post&&Date.now()-post.lastAccess<=ttl?post:null;};
  const getReplyPage = async (tid,page) => await getPost(tid) ? getRecord('replyPages',[String(tid),page]) : null;
  function saveReplyPage(tid, page, replies, metadata = {}) {
    if (!validTid(tid) || !Number.isInteger(page) || page < 1) return Promise.resolve(false);
    tid = String(tid);
    return write(model => {
      const op = replies.find(p=>p.floor===0);
      remember(model, { tid, ...(metadata.title ? {title:metadata.title} : {}), ...(metadata.url ? {url:metadata.url} : {}), ...(op ? {author:op.author,contentHtml:op.html} : {}) });
      model.replyPages.set(`${tid}:${page}`, {tid,page,replies,next:metadata.next,title:metadata.title,url:metadata.url,cachedAt:Date.now()}); return true;
    });
  }
  function saveListPages(streamKey, pages) {
    return write(model => {
      for (const [number,page] of pages) {
        for (const item of page.items) remember(model,item,item.lastAccess ?? Date.now());
        const id = `${streamKey}#${number}`;
        model.listPages.set(id,{id,streamKey,number,url:page.url,next:page.next,tids:page.items.map(i=>String(i.tid)),cachedAt:Date.now()});
      }
      return true;
    });
  }
  const getListPages = streamKey => read(model => [...model.listPages.values()].filter(p=>p.streamKey===streamKey).sort((a,b)=>a.number-b.number).map(p=>({...p,items:p.tids.map(tid=>model.posts.get(tid)).filter(Boolean)})));
  const getFavorites = () => read(model => Object.fromEntries([...model.relations.values()].filter(r=>r.kind==='favorite').map(r=>[r.tid,r.snapshot])), true);
  function setFavorite(item, saved) {
    const tid = String(item.tid);
    if(!validTid(tid))return Promise.resolve(false);
    const snapshot={};for(const field of ['tid','title','author','uid','replies','time','url','latest','pinned'])if(item[field]!==undefined)snapshot[field]=item[field];snapshot.tid=tid;
    return enqueue(async()=> { if(!await ready)return null; const result = await mutate(model => {
      const id = `favorite:${tid}`;
      if (saved) model.relations.set(id,{id,kind:'favorite',tid,savedAt:Date.now(),snapshot}); else model.relations.delete(id);
      return true;
    }); if(result) notify({type:'favorites'}); return result; });
  }
  // 封面只记录原图地址，图片本身交给浏览器 HTTP 缓存，不再写入 Blob。
  function saveCover(tid, source, metadata = {}) {
    tid = String(tid); const id = resourceId(source);
    if (!id || !validTid(tid) || !enabled) return Promise.resolve(false);
    uncommittedCovers.set(tid, id);
    return write(model => { remember(model, { ...metadata, tid }); const post = model.posts.get(tid); if (!post) return false; post.coverId = id; return true; })
      .then(result => { if (result) { uncommittedCovers.delete(tid); dropPendingCover(tid); notify({ type:'cover', tid, source:id }); } return !!result; });
  }
  async function getCover(tid) { const post = await getPost(tid); return post?.coverId ? { source: post.coverId, width: post.coverW, height: post.coverH } : null; }
  const cleanup=()=>enqueue(async()=>{if(!await ready)return null;return mutate(()=>true);});
  const remove=tids=>write(model=>{for(const tid of tids)removePost(model,String(tid));return true;});
  async function stats(){const used=await read(usage,true);return used||{available:false,enabled,maxPosts:postLimit,maxMetadataBytes};}
  function configure(options={}) {
    const changed=enabled!==(options.enabled!==false);enabled=options.enabled!==false;
    postLimit=Math.max(1,Math.min(maxPosts,Math.trunc(Number(options.maxPosts)||maxPosts)));
    if(changed)epoch++;return cleanup();
  }
  function clear() {
    epoch++;const generation=epoch;
    return enqueue(async()=>{if(!await ready)return null;const result=await mutate(model=>{for(const name of ['posts','replyPages','listPages'])model[name].clear();for(const [id,r]of model.relations)if(r.kind!=='favorite')model.relations.delete(id);return true;},generation);if(result){try{context.localStorage.removeItem(pendingCoverKey);}catch{}notify({type:'clear'});}return result;});
  }
  function scheduleCleanup(){if(context.requestIdleCallback)context.requestIdleCallback(()=>cleanup(),{timeout:5000});else context.setTimeout(()=>cleanup(),1000);}
  scheduleCleanup();const timer=context.setInterval(scheduleCleanup,30*60000);
  const close=()=>{flushPendingCovers();closed=true;context.clearInterval(timer);connection?.then(db=>db?.close());listeners.clear();channel?.close();};context.addEventListener('pagehide',e=>{if(!e.persisted)close();});
  return {ready,visit,getPost,getReplyPage,saveReplyPage,getListPages,saveListPages,getFavorites,setFavorite,getCover,saveCover,cleanup,remove,stats,configure,clear,get generation(){return epoch;},subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},close};
}
function createNavigation(config, context = globalThis.window) {
  const window = context;
  const { document, location, history, localStorage, sessionStorage } = window;
  const key = 'reader-toolkit-transition';
  let veil, timeout, background, scrollRestoration;
  const framed = window.top !== window.self;
  // 只允许本脚本创建的同源阅读容器运行适配器。
  function disposeBackground() {
    if (!background) return;
    clearInterval(background.poll); clearTimeout(background.timeout);
    document.title = background.title;
    background.cleanup?.();
    background.frame.remove(); background.notice.remove();
    if (background.list) {
      background.list.style.visibility = background.listVisibility;
      background.list.inert = background.listInert;
      background.list.style.overflow = background.listOverflow;
      if (document.documentElement.hasAttribute('data-readscape-document-scroll')) {
        window.scrollTo({ left: background.documentScroll.left, top: background.documentMode ? background.documentScroll.top : background.listScroll });
      } else {
        background.list.scrollTop = background.documentMode ? background.documentScroll.top : background.listScroll;
      }
    }
    document.documentElement.removeAttribute('data-readscape-reader-open');
    if (background.shown && background.focus?.isConnected) background.focus.focus({ preventScroll: true });
    background = null;
  }
  function openReader(u, restoring = false) {
    disposeBackground(); finish();
    const frame = document.createElement('iframe');
    frame.dataset.readscapeReader = 'true'; frame.dataset.readscapeListURL = (restoring && history.state?.readscapeListURL) || location.href; frame.title = '帖子与评论';
    frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;height:100dvh;border:0;z-index:2147483002;visibility:hidden;pointer-events:none;background:#fafafa;overscroll-behavior:none';
    const notice = document.createElement('div');
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'position:fixed;bottom:20px;left:16px;right:16px;width:fit-content;max-width:calc(100% - 32px);z-index:2147483003;padding:12px 16px;border-radius:14px;background:#fff;color:#555;box-shadow:0 4px 24px #0002;font:14px system-ui;display:flex;gap:12px;align-items:center;flex-wrap:wrap';
    const label = document.createElement('span'); label.textContent = '正在后台打开评论…';
    const original = document.createElement('a'); original.href = u.href; original.textContent = '直接打开';
    original.dataset.readscapeNative = 'true';
    const cancel = document.createElement('button'); cancel.textContent = '取消';
    cancel.onclick = () => { if (restoring) history.back(); else disposeBackground(); };
    notice.append(label, original, cancel);
    const state = background = { frame, notice, url: u.href, title: document.title, focus: document.activeElement };
    const fail = () => {
      if (background !== state) return;
      disposeBackground();
      // 后台启动失败也必须完成点击意图，退回浏览器正常导航。
      location.assign(u.href);
    };
    frame.addEventListener('readscape-return', () => history.back());
    frame.addEventListener('error', fail);
    frame.src = u.href;
    document.documentElement.append(frame, notice);
    state.poll = setInterval(() => {
      if (background !== state) return;
      try {
        const doc = frame.contentDocument;
        if (doc?.body && doc.readyState !== 'loading' && doc.URL !== 'about:blank' && state.mountedDoc !== doc) {
          const childURL = new URL(doc.URL);
          if (childURL.origin !== location.origin || !config.accepts(childURL)) { fail(); return; }
          state.cleanup?.(); state.mountedDoc = doc;
          state.cleanup = config.mountReader?.(frame.contentWindow);
        }
        const reader = doc?.getElementById('nga-cards-host')?.shadowRoot?.querySelector('.reader');
        if (!reader || reader.hidden || !reader.querySelector('.comment')) return;
        // 就绪前保留列表、滚动位置和焦点；地址与历史只在成功后更新。
        if (!restoring) history.pushState({ ...history.state, readscapeReader: u.href, readscapeListURL: frame.dataset.readscapeListURL }, '', u.href);
        clearInterval(state.poll); clearTimeout(state.timeout);
        frame.style.visibility = 'visible'; frame.style.pointerEvents = 'auto';
        const list = document.getElementById('nga-cards-host')?.shadowRoot?.querySelector('.app:not(.reader)');
        if (list) {
          Object.assign(state, { list, listVisibility: list.style.visibility, listInert: !!list.inert, listOverflow: list.style.overflow, listScroll: list.scrollTop,
            documentMode: document.documentElement.hasAttribute('data-readscape-document-scroll'), documentScroll: { left: window.scrollX, top: window.scrollY } });
          list.style.visibility = 'hidden'; list.inert = true; list.style.overflow = 'hidden';
          document.documentElement.setAttribute('data-readscape-reader-open', '');
          // 原列表仍在文档中；由它保留位置，避免浏览器遍历历史时另行滚动。
          if (scrollRestoration === undefined) scrollRestoration = history.scrollRestoration ?? 'auto';
          history.scrollRestoration = 'manual';
        }
        state.shown = true; document.title = doc.title;
        notice.remove(); frame.focus({ preventScroll: true });
      } catch { fail(); }
    }, 100);
    state.timeout = setTimeout(fail, 15000);
  }
  function onPopState(event) {
    disposeBackground(); finish();
    const url = event.state?.readscapeReader;
    if (typeof url !== 'string' || !enabled()) return;
    try { const u = new URL(url); if (u.origin === location.origin && config.accepts(u)) openReader(u, true); } catch {}
  }
  if (!framed) window.addEventListener('popstate', onPopState);
  function finish() {
    veil?.remove(); veil = null; clearTimeout(timeout);
    if (!enabled()) {
      disposeBackground();
      if (scrollRestoration !== undefined) { history.scrollRestoration = scrollRestoration; scrollRestoration = undefined; }
    }
    try { sessionStorage.removeItem(key); } catch {}
  }
  function show() {
    if (veil || !document.documentElement) return;
    veil = document.createElement('div');
    veil.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#fff;display:grid;place-items:center;color:#888;font:14px system-ui';
    const box = document.createElement('div'); box.style.textAlign = 'center';
    const label = document.createElement('p'); label.textContent = '正在打开页面…';
    const cancel = document.createElement('button'); cancel.textContent = '显示原页';
    cancel.style.cssText = 'border:0;border-radius:22px;padding:10px 18px;background:#f3f3f5;color:#777;font:inherit';
    cancel.onclick = finish; box.append(label, cancel); veil.append(box);
    document.documentElement.append(veil);
    timeout = setTimeout(finish, 12000);
  }
  function enabled() {
    try { const p = JSON.parse(localStorage.getItem(config.storageKey) || '{}'); return p.enabled !== false && p.smoothNavigation !== false; } catch { return true; }
  }
  try {
    const pending = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (enabled() && pending && Date.now() - pending.at < 20000 && pending.origin === location.origin && config.accepts(new URL(location.href))) show();
    else sessionStorage.removeItem(key);
  } catch {}
  // 列表到评论使用完整同源页面后台加载；其他链接保留原生导航。
  function capture(event) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !enabled()) return;
    const a = event.composedPath().find(n => n?.tagName === 'A');
    if (!a || a.hasAttribute('data-readscape-native') || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
    let u; try { u = new URL(a.href, location.href); } catch { return; }
    if (u.origin !== location.origin || !config.accepts(u) || (u.pathname === location.pathname && u.search === location.search)) return;
    if (framed && /\/thread\.php$/.test(u.pathname)) {
      const listURL = new URL(window.frameElement.dataset.readscapeListURL);
      if (['stid', 'fid'].every(key => u.searchParams.get(key) === listURL.searchParams.get(key))) {
        event.preventDefault();
        window.frameElement.dispatchEvent(new Event('readscape-return'));
        return;
      }
    }
    const list = document.getElementById('nga-cards-host')?.shadowRoot?.querySelector('.app:not(.reader)');
    if (!framed && list && !list.hidden && /\/read\.php$/.test(u.pathname)) {
      event.preventDefault(); openReader(u); return;
    }
    try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), origin: u.origin })); } catch {}
    show();
  }
  document.addEventListener('click', capture);
  window.addEventListener('pageshow', e => { if (e.persisted) finish(); });
  return { finish, show, destroy() { disposeBackground(); finish(); if (scrollRestoration !== undefined) history.scrollRestoration = scrollRestoration; document.removeEventListener('click', capture); window.removeEventListener('popstate', onPopState); } };
}

function mountSettings({ context = globalThis.window, shadow, app, prefs, save, change, original, login, cache }) {
  const document = context.document;
  const style = document.createElement('style');
  style.textContent = `
    .rt-mask[hidden],.rt-fab[hidden]{display:none!important}
    .rt-fab,.rt-mask{--rt-surface:#fff8fa;--rt-text:#30272d;--rt-muted:#776b73;--rt-accent:#a43d60;--rt-container:#f5dce5;--rt-outline:#d8c4cc}
    [data-rt-theme=dark]{--rt-surface:#29232a;--rt-text:#f3e4ed;--rt-muted:#cbb9c4;--rt-accent:#f4adc7;--rt-container:#61394b;--rt-outline:#806d78;color-scheme:dark}
    [data-rt-theme=paper]{--rt-surface:#faf5eb;--rt-text:#3c332d;--rt-muted:#7b6f61;--rt-container:#eee2cf;--rt-outline:#d3c5b2}
    .rt-fab{position:fixed;right:16px;bottom:calc(24px + env(safe-area-inset-bottom));z-index:2147483010;width:56px;height:56px;display:grid;place-items:center;border:0;border-radius:18px;background:var(--rt-container);color:var(--rt-accent);box-shadow:0 3px 8px #38212e26,0 1px 3px #38212e1a;touch-action:manipulation;transition:box-shadow .18s,transform .18s}
    .rt-fab:active{transform:scale(.94);box-shadow:0 1px 3px #38212e33}.rt-fab svg{width:24px;height:24px;pointer-events:none}
    .rt-mask{position:fixed;inset:0;z-index:2147483011;width:100%;height:100%;height:100dvh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;pointer-events:none;display:flex;align-items:flex-end;justify-content:center;color:var(--rt-text);overscroll-behavior:contain}.rt-mask::backdrop{background:transparent}
    .rt-sheet{background:var(--rt-surface);color:var(--rt-text);pointer-events:auto;width:min(100%,360px);max-height:45dvh;overflow:auto;overscroll-behavior:contain;padding:0 16px calc(12px + env(safe-area-inset-bottom));border-radius:20px 20px 0 0;box-shadow:0 -8px 32px #21132126;font:15px/1.5 system-ui}
    .rt-handle{display:flex;align-items:center;justify-content:center;width:100%;height:24px;touch-action:none;cursor:grab}.rt-handle:before{content:'';width:32px;height:4px;border-radius:4px;background:var(--rt-muted);opacity:.45}
    .rt-sheet h2{font-size:18px;font-weight:600;margin:0}.rt-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:16px}.rt-sheet label{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:46px;border-bottom:1px solid color-mix(in srgb,var(--rt-outline) 40%,transparent);cursor:pointer}.rt-sheet select{max-width:180px;min-height:36px;padding:6px 10px;border:1px solid var(--rt-outline);border-radius:12px;background:transparent;color:var(--rt-text);font:inherit}
    .rt-range{display:flex;align-items:center;gap:10px}.rt-scale{min-width:40px;text-align:right;font-size:13px;color:var(--rt-muted);font-variant-numeric:tabular-nums}.rt-sheet input[type=range]{width:110px;height:36px;accent-color:var(--rt-accent);cursor:pointer}
    .rt-sheet input[type=checkbox]{appearance:none;-webkit-appearance:none;flex:none;width:52px;height:32px;border:2px solid var(--rt-outline);border-radius:20px;background:var(--rt-outline);position:relative;cursor:pointer;transition:background .18s,border-color .18s}.rt-sheet input[type=checkbox]:before{content:'';position:absolute;left:4px;top:4px;width:20px;height:20px;border-radius:50%;background:var(--rt-muted);transition:transform .18s,background .18s}.rt-sheet input[type=checkbox]:checked{background:var(--rt-accent);border-color:var(--rt-accent)}.rt-sheet input[type=checkbox]:checked:before{transform:translateX(20px);background:var(--rt-surface)}
    .rt-sheet button{min-height:44px;padding:8px 14px;border-radius:24px;background:var(--rt-container);color:var(--rt-accent);font-weight:600;touch-action:manipulation;transition:filter .15s}.rt-sheet button:active{filter:brightness(.9)}.rt-sheet .rt-close{background:var(--rt-accent);color:var(--rt-surface)}.rt-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}.rt-actions button{flex:1;white-space:nowrap}.rt-more{margin-top:8px}.rt-more>summary{cursor:pointer;color:var(--rt-muted);padding:8px 0}.rt-header h2{white-space:nowrap}.rt-header .rt-account{font-size:12px;padding:6px 10px;min-width:0;max-width:140px}.account-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.account-uid{display:block;font-size:10px;font-weight:400;white-space:nowrap;opacity:.75}.rt-note{font-size:12px;color:var(--rt-muted);margin:10px 0 0}
    .rt-cache{border-top:1px solid var(--rt-container);margin-top:12px;padding-top:8px}.rt-cache-usage{font-size:12px;line-height:1.6;color:var(--rt-muted);margin:4px 0 8px;overflow-wrap:anywhere}.rt-cache summary{padding:8px 0;cursor:pointer;color:var(--rt-muted)}.rt-cache input[type=number]{width:84px;min-height:36px;background:var(--rt-container);color:var(--rt-text);border:0;border-radius:8px;padding:6px}
    .rt-reader-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:0 0 8px}.rt-reader-actions[hidden]{display:none}.rt-reader-actions{grid-template-columns:repeat(3,minmax(0,1fr))}.rt-reader-actions button,.rt-reader-actions a{display:flex;align-items:center;justify-content:center;min-height:44px;border-radius:24px;background:var(--rt-container);color:var(--rt-accent);font-weight:600;padding:8px 4px;font-size:13px}.rt-reader-actions .reply-entry{background:var(--rt-accent);color:var(--rt-surface)}
    @keyframes rt-sheet-enter{from{transform:translateY(48px);opacity:0}to{transform:translateY(0);opacity:1}}
    @media(prefers-reduced-motion:reduce){.rt-sheet{animation:none}.rt-fab,.rt-sheet button,.rt-sheet input[type=checkbox],.rt-sheet input[type=checkbox]:before{transition:none}}
    .app{font-family:var(--rt-font,system-ui);max-width:100vw;overflow-x:hidden;text-size-adjust:100%;-webkit-text-size-adjust:100%}.app main,.grid,.bar{min-width:0;width:100%}.grid>.card{min-width:0;max-width:100%}
    .app.rt-settings-open{padding-bottom:calc(30px + var(--rt-panel-height,260px) + env(safe-area-inset-bottom))}.app .comment-content{font-size:calc(15px * var(--rt-scale,1))}.app .comment.op .comment-content{font-size:calc(16px * var(--rt-scale,1))}.app .thread .comment-content{font-size:calc(14px * var(--rt-scale,1))}.app .mobile-caption,.app .image-title{font-size:calc(14px * var(--rt-scale,1))}.app .cover .title{font-size:calc(18px * var(--rt-scale,1))}
    .app.rt-paper{background:#f6f2e9}.app.rt-paper .top,.app.rt-paper .card,.app.rt-paper .comment.op{background:#faf7ef}.app.rt-dark{background:#17191d;color:#e0e0e5;color-scheme:dark}.app.rt-dark .top,.app.rt-dark .card,.app.rt-dark .comment{background:#202329;border-color:#34373e}.app.rt-dark .comment-content,.app.rt-dark .tabs button[aria-selected=true],.app.rt-dark .tabs button[aria-pressed=true]{color:#eee}.app.rt-dark .quoted,.app.rt-dark .search input,.app.rt-dark .load-next{background:#2c3038;color:#bbb}.app.rt-dark .cover:not(.has-image){background:#30343d}.app.rt-dark .cover .title,.app.rt-dark .eyebrow{color:#ddd}.app.rt-dark .tag{background:#444;color:#ddd}
    @media(min-width:601px){.rt-mask{align-items:flex-end;justify-content:flex-end;padding:0 20px 20px}.rt-sheet{border-radius:20px}.rt-fab{bottom:24px}.app .cover .title{font-size:calc(20px * var(--rt-scale,1))}.app .image-title{font-size:calc(16px * var(--rt-scale,1))}}
  `;
  shadow.append(style);
  const fab = document.createElement('button'); fab.type = 'button'; fab.className = 'rt-fab'; fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>'; fab.setAttribute('aria-haspopup', 'dialog'); fab.setAttribute('aria-controls', 'readscape-settings'); fab.setAttribute('aria-label', '阅读设置'); fab.setAttribute('aria-expanded', 'false');
  const mask = document.createElement('dialog'); mask.id = 'readscape-settings'; mask.setAttribute('aria-label', '阅读设置'); mask.className = 'rt-mask'; mask.hidden = true;
  const sheet = document.createElement('section'); sheet.className = 'rt-sheet'; sheet.tabIndex = -1;
  const header = document.createElement('div'); header.className = 'rt-header';
  const title = document.createElement('h2'); title.textContent = '阅读设置';
  const close = document.createElement('button'); close.className = 'rt-close'; close.textContent = '完成'; header.append(title, close);
  const handle = document.createElement('div'); handle.className = 'rt-handle'; handle.setAttribute('aria-hidden', 'true'); sheet.append(handle, header);
  let dragStart;
  handle.addEventListener('pointerdown', event => { dragStart = event.clientY; handle.setPointerCapture?.(event.pointerId); });
  handle.addEventListener('pointerup', event => { if (dragStart != null && event.clientY - dragStart > 60) hide(); dragStart = null; });
  handle.addEventListener('pointercancel', () => { dragStart = null; });
  const controls = new Map();
  const readerActions = document.createElement('div'); readerActions.className = 'rt-reader-actions'; readerActions.hidden = true; sheet.append(readerActions);
  function apply() {
    const scale = Math.min(1.4, Math.max(.85, Number(prefs.fontScale) || 1));
    app.style.setProperty('--rt-scale', scale);
    app.style.setProperty('--rt-font', prefs.font === 'serif' ? '"Songti SC","Noto Serif CJK SC",serif' : prefs.font === 'rounded' ? 'ui-rounded,"Arial Rounded MT Bold","PingFang SC",sans-serif' : '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif');
    mask.dataset.rtTheme = fab.dataset.rtTheme = prefs.theme || 'light';
    app.classList.toggle('rt-paper', prefs.theme === 'paper'); app.classList.toggle('rt-dark', prefs.theme === 'dark');
  }
  function row(label, key, type, options, target = sheet) {
    const wrap = document.createElement('label'); const text = document.createElement('span'); text.textContent = label;
    const c = document.createElement(type === 'select' ? 'select' : 'input'); c.setAttribute('aria-label', label); c.dataset.pref = key;
    if (type === 'select') for (const [value, name] of options) { const opt = document.createElement('option'); opt.value = value; opt.textContent = name; c.append(opt); }
    else { c.type = type; if (type === 'checkbox') c.setAttribute('role', 'switch'); if (type === 'range') { c.min = '.85'; c.max = '1.4'; c.step = '.05'; } }
    const update = () => { prefs[key] = type === 'checkbox' ? c.checked : type === 'range' || type === 'number' ? Number(c.value) : c.value; if (key === 'cacheMaxPosts') prefs[key] = Math.max(1, Math.min(500, Math.trunc(prefs[key]) || 0)); save(); sync(); apply(); configureCache(); change(); };
    c.addEventListener(type === 'range' ? 'input' : 'change', update); controls.set(key, c); wrap.append(text);
    if (type === 'range') { const group = document.createElement('span'); group.className = 'rt-range'; const value = document.createElement('output'); value.className = 'rt-scale'; value.setAttribute('aria-label', '当前字号'); group.append(c, value); wrap.append(group); } else wrap.append(c);
    target.append(wrap);
  }
  row('字号', 'fontScale', 'range'); row('字体', 'font', 'select', [['system','系统字体'],['serif','宋体 / 衬线'],['rounded','圆润字体']]);
  const more = document.createElement('details'); more.className = 'rt-more';
  const moreTitle = document.createElement('summary'); moreTitle.textContent = '更多设置'; more.append(moreTitle); sheet.append(more);
  row('配色', 'theme', 'select', [['light','明亮'],['paper','暖纸'],['dark','深色']], more);
  row('手机单列', 'single', 'checkbox', undefined, more); row('关联对话', 'groupReplies', 'checkbox', undefined, more); row('平滑跳转过渡', 'smoothNavigation', 'checkbox', undefined, more);
  const note = document.createElement('p'); note.className = 'rt-note'; note.textContent = '字体使用设备现有字体。单双列适用于列表；关联对话适用于评论，关闭时按楼层顺序阅读。'; more.append(note);
  const actions = document.createElement('div'); actions.className = 'rt-actions';
  const reset = document.createElement('button'); reset.textContent = '恢复默认';
  const native = document.createElement('button'); native.textContent = '查看原版'; actions.append(reset, native); more.append(actions);
  const cacheSection = document.createElement('section'); cacheSection.className = 'rt-cache'; cacheSection.hidden = !cache;
  const cacheUsage = document.createElement('p'); cacheUsage.className = 'rt-cache-usage'; cacheUsage.setAttribute('role', 'status'); cacheUsage.textContent = '正在统计缓存…';
  const cacheOptions = document.createElement('details'); const cacheTitle = document.createElement('summary'); cacheTitle.textContent = '缓存设置'; cacheOptions.append(cacheTitle);
  row('本地缓存', 'cacheEnabled', 'checkbox', undefined, cacheOptions); row('帖子上限', 'cacheMaxPosts', 'number', undefined, cacheOptions);
  { const input = controls.get('cacheMaxPosts'); input.min = '1'; input.max = '500'; input.step = '1'; }
  const clearCache = document.createElement('button'); clearCache.type = 'button'; clearCache.className = 'rt-clear-cache'; clearCache.textContent = '清理缓存';
  const cacheNote = document.createElement('p'); cacheNote.className = 'rt-note'; cacheNote.textContent = '7 天未访问自动清理。手动清理保留收藏书签和阅读设置。';
  cacheSection.append(cacheUsage, clearCache, cacheOptions, cacheNote); sheet.append(cacheSection);
  let cacheVersion = 0, clearingCache = false;
  const formatBytes = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
  async function refreshCache() {
    if (!cache || clearingCache) return;
    const version = ++cacheVersion, used = await cache.stats();
    if (version !== cacheVersion || clearingCache) return;
    if (!used.available) { cacheUsage.textContent = '本地缓存不可用，仍可正常阅读。'; clearCache.disabled = true; return; }
    clearCache.disabled = false;
    cacheUsage.textContent = `缓存估算 ${formatBytes(used.totalBytes)} · 帖子 ${used.posts}/${used.maxPosts} · 回复 ${used.replyPages} 页${used.enabled ? '' : ' · 缓存已关闭'}`;
  }
  function configureCache() { cache?.configure({enabled:prefs.cacheEnabled !== false,maxPosts:prefs.cacheMaxPosts ?? 500}).then(refreshCache); }
  clearCache.onclick = async () => {
    if (clearingCache) return; clearingCache = true; cacheVersion++; clearCache.disabled = true; cacheUsage.textContent = '正在清理缓存…';
    const cleared = await cache.clear(); clearingCache = false;
    if (cleared) { await refreshCache(); cacheUsage.textContent = `缓存已清理 · ${cacheUsage.textContent}`; } else { cacheUsage.textContent = '缓存清理失败，请重试。'; clearCache.disabled = false; }
  };
  let cacheRefreshTimer;
  const unsubscribeCache = cache?.subscribe(() => { if (!mask.hidden) { context.clearTimeout(cacheRefreshTimer); cacheRefreshTimer=context.setTimeout(refreshCache,80); } });
  context.addEventListener('pagehide', () => { unsubscribeCache?.(); context.clearTimeout(cacheRefreshTimer); });
  function sync() { for (const [key,c] of controls) { if (c.type === 'checkbox') c.checked = ['smoothNavigation','cacheEnabled'].includes(key) ? prefs[key] !== false : !!prefs[key]; else c.value = prefs[key] ?? ({fontScale:1,font:'system',theme:'light',cacheMaxPosts:500}[key]); } sheet.querySelector('.rt-scale').textContent = `${Math.round(Number(controls.get('fontScale').value) * 100)}%`; }
  const account = document.createElement('button'); account.className = 'rt-account'; account.textContent = '登录'; account.onclick = () => { hide(true, true); login?.(account); }; if (login) header.insertBefore(account, close);
  let opener = fab, sheetAnimation, animationVersion = 0, closing = false;
  const measurePanel = () => app.style.setProperty('--rt-panel-height', `${Math.ceil(sheet.getBoundingClientRect().height)}px`);
  const panelObserver = typeof context.ResizeObserver === 'function' ? new context.ResizeObserver(measurePanel) : null;
  panelObserver?.observe(sheet);
  context.addEventListener('pagehide', () => panelObserver?.disconnect());
  function motionFrames() {
    const source = opener.getBoundingClientRect(), target = sheet.getBoundingClientRect();
    const x = source.left + source.width / 2 - target.left - target.width / 2;
    const y = source.top + source.height / 2 - target.top - target.height / 2;
    return [{opacity:0,transform:`translate(${x * .16}px,${y * .12}px) scale(.92)`},{opacity:1,transform:'translate(0,0) scale(1)'}];
  }
  const canAnimate = () => typeof sheet.animate === 'function' && !context.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function hide(restoreFocus = true, immediate = false) {
    if (mask.hidden) return;
    const version = ++animationVersion; sheetAnimation?.cancel(); closing = true;
    fab.setAttribute('aria-expanded','false');
    const finish = () => {
      if (version !== animationVersion) return;
      if (typeof mask.close === 'function' && mask.open) mask.close(); else mask.removeAttribute('open');
      mask.hidden = true; closing = false; app.classList.remove('rt-settings-open');
      if (restoreFocus && opener.isConnected && !app.hidden) opener.focus({ preventScroll: true });
    };
    if (!immediate && canAnimate()) {
      sheetAnimation = sheet.animate(motionFrames().reverse(), {duration:180,easing:'cubic-bezier(.4,0,1,1)',fill:'forwards'});
      sheetAnimation.finished.then(finish, () => {});
    } else finish();
  }
  function open(trigger = fab) {
    if (!mask.hidden && !closing) return;
    animationVersion++; closing = false; sheetAnimation?.cancel();
    sync(); readerActions.querySelectorAll('a').forEach(a => a.refreshHref?.()); opener = trigger; mask.hidden = false;
    if (!mask.open) { if (typeof mask.show === 'function') mask.show(); else mask.setAttribute('open', ''); }
    app.classList.add('rt-settings-open'); measurePanel();
    refreshCache();
    if (canAnimate()) sheetAnimation = sheet.animate(motionFrames(), {duration:260,easing:'cubic-bezier(.2,.8,.2,1)'});
    fab.setAttribute('aria-expanded','true'); close.focus({ preventScroll: true });
  }
  fab.onclick = () => open();
  mask.addEventListener('cancel', event => { event.preventDefault(); hide(); });
  close.onclick = () => hide(); native.onclick = () => { hide(true, true); original(); };
  reset.onclick = () => { Object.assign(prefs,{fontScale:1,font:'system',theme:'light',single:false,groupReplies:false,smoothNavigation:true,cacheEnabled:true,cacheMaxPosts:500}); save(); sync(); apply(); configureCache(); change(); };
  mask.onclick = e => { if (e.target === mask) hide(); };
  mask.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); }
  });
  mask.append(sheet); shadow.append(fab, mask); sync(); apply(); configureCache();
  return {
    sync, open,
    setAccount(info) {
      account.replaceChildren();
      if (!info) { account.textContent = '未登录 · 登录'; account.setAttribute('aria-label', '未登录，登录 NGA'); return; }
      const name = document.createElement('span'); name.className = 'account-name'; name.textContent = info.username;
      const uid = document.createElement('span'); uid.className = 'account-uid'; uid.textContent = `UID ${info.uid}`;
      account.append(name, uid); account.setAttribute('aria-label', `${info.username}，UID ${info.uid}，查看个人资料`);
    },
    setActions(items) {
      readerActions.replaceChildren(); readerActions.hidden = !items.length;
      return items.map(({ label, className, action, href, target = '_top' }) => {
        const control = document.createElement(href ? 'a' : 'button'); if (!href) control.type = 'button'; control.className = className; control.textContent = label;
        if (href) { control.href = href(); control.target = target; if (target === '_blank') control.rel = 'noopener noreferrer'; control.dataset.readscapeNative = 'true'; control.refreshHref = () => { control.href = href(); }; }
        control.onclick = () => { control.refreshHref?.(); hide(true, true); action?.(); }; readerActions.append(control); return control;
      });
    },
    visibility(enabled) { fab.hidden = !enabled; if (!enabled) hide(false, true); }
  };
}

function runAdapter({ navigation, postCache, context = globalThis.window }) {
  const window = context;
  const { document, location, localStorage, sessionStorage } = window;
  const fetch = (...args) => window.fetch(...args);
  if (document.getElementById('nga-cards-host')) return;

  const KEY = 'nga-cards-v1';
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 禁用存储时仍可阅读 */ } };
  const prefs = read(KEY, { enabled: true, single: false });
  const favorites = read(`${KEY}-favorites`, {}), favoriteChanges = new Set();
  const pageURL = new URL(location.href);
  const host = document.createElement('div');
  host.id = 'nga-cards-host';
  // Shadow DOM 避免 NGA 自带 CSS 与卡片样式互相影响。
  const shadow = host.attachShadow({ mode: 'open' });
  const originalOverflow = document.documentElement.style.overflow;
  let nativeScroll, readingScroll = 0;
  const mobileViewport = window.matchMedia?.('(max-width:600px)');
  // 原页只作为数据源保留。阅读容器放在 body 外，避免原站的布局、
  // transform 和触摸滚动影响前景；晚到的原页节点也不会重新露出。
  const surfaceStyle = document.createElement('style');
  surfaceStyle.textContent = `
    html[data-readscape-active]{overflow:hidden!important;overscroll-behavior:none!important;height:100%!important;margin:0!important;padding:0!important;transform:none!important;filter:none!important;perspective:none!important;contain:none!important;content-visibility:visible!important;background:#fafafa!important}
    html[data-readscape-active]>body{display:none!important}
    html[data-readscape-active]::before,html[data-readscape-active]::after{display:none!important}
    html[data-readscape-active]>#nga-cards-host{all:initial!important;display:block!important;position:fixed!important;inset:0!important;width:100%!important;height:100%!important;height:100dvh!important;z-index:2147483000!important;isolation:isolate!important}
    html[data-readscape-document-scroll]{overflow-x:clip!important;overflow-y:auto!important;height:auto!important;min-height:100%!important;overscroll-behavior-y:auto!important}
    html[data-readscape-document-scroll]>#nga-cards-host{position:relative!important;inset:auto!important;height:auto!important;min-height:100svh!important;contain:none!important}
    html[data-readscape-reader-open]{overflow:hidden!important;overscroll-behavior:none!important}
  `;
  document.head.append(surfaceStyle);
  const originalViewport = document.querySelector('meta[name="viewport"]');
  const originalViewportContent = originalViewport?.getAttribute('content');
  const viewport = originalViewport || document.createElement('meta');
  viewport.name = 'viewport';
  let items = [], tab = 'all', query = '', signature = '', timer;
  let cardObserver, listObserver;
  const listCards = new Map();
  let coverDisposed = false;
  let gateHandled = false, gateTimer;
  let modeToggle = toggle;
  let settingsRefresh = render;
  let readingSettings;
  let accountChanged = () => {};

  const css = "\n    :host{all:initial;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif;color:#27272b;font-size:14px;line-height:1.5}\n    *{box-sizing:border-box}button,input,a{-webkit-tap-highlight-color:transparent}button,input{font:inherit}button,a{touch-action:manipulation}button{cursor:pointer}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #ff7994;outline-offset:3px}\n    a{color:inherit;text-decoration:none}button{border:0;background:none;color:inherit}button:disabled{cursor:default;opacity:.5}[hidden]{display:none!important}\n    .app{position:absolute;inset:0;z-index:2147483000;background:#fafafa;overflow:auto;overscroll-behavior:none;touch-action:pan-x pan-y pinch-zoom;scrollbar-gutter:stable;-webkit-overflow-scrolling:touch;padding-bottom:calc(30px + env(safe-area-inset-bottom));color-scheme:light}\n    .top{position:sticky;top:0;z-index:3;background:rgba(255,255,255,.96);border-bottom:1px solid #ededf0;padding:calc(14px + env(safe-area-inset-top)) 24px 14px;backdrop-filter:blur(16px)}\n    .bar{max-width:1440px;margin:auto;display:flex;align-items:center;gap:18px}.brand{font-size:23px;font-weight:850;letter-spacing:-1px;white-space:nowrap}.brand span{color:#ff2442}\n    .search{flex:1;max-width:460px;position:relative}.search input{width:100%;border:1px solid transparent;border-radius:28px;padding:11px 18px;background:#f4f4f6;color:#26262a;outline:none}.search input:focus{border-color:#ff2442}\n    .spacer{flex:1}.pill{padding:9px 15px;background:#f1f1f4;border-radius:22px;white-space:nowrap;font-size:13px}.pill:hover{background:#e8e8ed}\n    main{max-width:1440px;margin:auto;padding:28px 24px}.intro{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:16px}h1{font-size:25px;letter-spacing:-.7px;margin:0 0 5px}.sub{font-size:12px;color:#8b8b95}.settings{display:none;gap:12px;flex-wrap:wrap;align-items:center;font-size:12px;color:#666671}.settings label{cursor:pointer;display:flex;align-items:center;gap:5px;min-height:36px}.settings input{accent-color:#ff2442}\n    .tabs{display:flex;gap:7px;margin:18px 0 23px}.tabs button{padding:9px 20px;border-radius:22px;color:#777781}.tabs button[aria-selected=true]{background:#ff2442;color:#fff;font-weight:650}\n    .grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:20px;align-items:start}.card{border-radius:18px;overflow:hidden;background:#fff;border:1px solid #eeeeef;box-shadow:0 2px 6px #00000003;transition:transform .18s,box-shadow .18s;min-width:0}.card:hover{transform:translateY(-3px);box-shadow:0 9px 24px #00000009}\n    .cover{display:flex;flex-direction:column;justify-content:space-between;min-height:190px;padding:20px;background:var(--bg);position:relative;overflow:hidden}.cover:after{content:'';width:110px;height:110px;border-radius:100%;border:20px solid #ffffff60;position:absolute;right:-35px;bottom:-35px;pointer-events:none}.eyebrow{display:flex;gap:5px;align-items:center;font-size:10px;letter-spacing:1px;color:#0008}.tag{font-size:10px;border-radius:6px;padding:2px 6px;background:#ffffff90;letter-spacing:0;color:#59575b}.title{font-size:20px;font-weight:750;line-height:1.5;letter-spacing:-.5px;position:relative;z-index:1;overflow-wrap:anywhere;margin:13px 0 8px;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}.cover.has-image{padding:0;min-height:0}.cover img{width:100%;height:220px;object-fit:cover;display:block;background:#f3f3f3}.image-title{font-size:16px;line-height:1.55;font-weight:700;margin:0 0 9px;overflow-wrap:anywhere}\n    .body{padding:13px 15px 14px}.summary{font-size:12px;color:#7a7a84;line-height:1.8;margin:0 0 11px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}.person{display:flex;align-items:center;gap:7px;min-width:0}.avatar{display:flex;align-items:center;justify-content:center;width:23px;height:23px;border-radius:50%;background:var(--bg);color:#777;font-size:11px;flex:none}.author{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;color:#686872}.save{font-size:20px;line-height:1;padding:6px;flex:none}.save[aria-pressed=true]{color:#ff2442}.meta{display:flex;align-items:center;gap:8px;justify-content:space-between;font-size:10px;color:#9999a2;margin-top:9px;flex-wrap:wrap}.latest{color:#777781;text-decoration:underline;text-underline-offset:3px}.preview{font-size:11px;padding:5px 0;color:#9c7781;margin-top:7px;text-align:left}\n    .pager{display:flex;justify-content:center;flex-wrap:wrap;gap:7px;margin:30px 0 12px}.pager a,.pager span{padding:8px 14px;border-radius:12px;background:#fff;border:1px solid #eee}.pager .current{background:#ff2442;color:white;border-color:#ff2442}.empty{text-align:center;padding:55px 16px;color:#999;font-size:14px}.foot{text-align:center;font-size:11px;color:#999;margin-top:18px}.restore{position:fixed;right:16px;bottom:calc(18px + env(safe-area-inset-bottom));z-index:2147483001;border-radius:24px;background:#ff2442;color:#fff;padding:12px 18px;box-shadow:0 4px 16px #ff244233}\n    @media(min-width:1500px){.grid{grid-template-columns:repeat(6,minmax(0,1fr))}}\n    @media(max-width:1150px){.grid{grid-template-columns:repeat(4,minmax(0,1fr))}.spacer{display:none}}\n    @media(max-width:900px){.grid{grid-template-columns:repeat(3,minmax(0,1fr))}.intro{align-items:flex-start;flex-direction:column}.cover{min-height:170px}}\n    @media(max-width:600px){.top{padding:calc(10px + env(safe-area-inset-top)) 12px 10px}.bar{gap:10px;flex-wrap:wrap}.brand{font-size:21px}.search{order:3;max-width:none;flex-basis:100%}.bar>.pill{margin-left:auto;padding:7px 12px}.search input{padding:9px 15px}main{padding:20px 12px}.intro{gap:5px;margin-bottom:6px}h1{font-size:21px}.settings{gap:12px}.tabs{margin:12px 0 16px}.tabs button{padding:8px 17px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.card{border-radius:13px}.cover{min-height:178px;padding:14px}.title{font-size:17px;line-height:1.55;-webkit-line-clamp:5}.body{padding:10px 11px}.cover img{height:180px}.image-title{font-size:14px}.summary{font-size:11px}.avatar{width:20px;height:20px}.author{font-size:11px}.meta{font-size:10px;gap:4px}.grid.single{grid-template-columns:1fr}.grid.single .cover{min-height:120px}.grid.single .title{-webkit-line-clamp:3}.grid.single .cover img{height:240px}}\n    @media(prefers-reduced-motion:reduce){.card{transition:none}.card:hover{transform:none}}\n    .mobile-tool,.mobile-caption,.settings-native{display:none}\n    @media(max-width:600px){\n      .app{background:#fff}.top{background:#fff;border-bottom:0;padding:calc(8px + env(safe-area-inset-top)) 14px 8px;backdrop-filter:none}.bar{gap:8px;align-items:center}.brand{font-size:18px;letter-spacing:0;background:#ff2442;color:white;border-radius:22px;padding:5px 12px;line-height:1.5}.brand span{color:white}\n      .mobile-tool{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;border-radius:50%;font-size:25px;color:#555}.mobile-tool:first-of-type{margin-left:auto}.bar>.pill{display:none}.bar>.search{display:none}.app.search-open .search{display:block;order:3;flex-basis:100%}.search input{font-size:16px;background:#f6f6f7}\n      main{padding:10px 12px 24px}.intro{gap:8px;margin:5px 2px 0}h1{font-size:17px;letter-spacing:0;font-weight:650}.sub{font-size:11px;color:#aaa}.settings{display:none;width:100%;padding:9px 12px;background:#f8f8fa;border-radius:12px}.app.options-open .settings{display:flex}.settings-native{display:inline-block;font-size:12px;color:#a66d7d;padding:7px 0}\n      .tabs{gap:26px;overflow-x:auto;scrollbar-width:none;margin:14px 2px 21px}.tabs button{padding:8px 0;border-radius:0;background:none;font-size:16px;color:#888;flex:none;border-bottom:2px solid transparent}.tabs button[aria-selected=true]{background:none;color:#242428;font-weight:700;border-bottom-color:#ff2442}\n      .grid{gap:18px 12px}.card{border:0;background:transparent;border-radius:0;box-shadow:none}.card:hover{transform:none;box-shadow:none}.cover{border-radius:13px}.cover:not(.has-image){aspect-ratio:4/5;min-height:0;justify-content:center;padding:16px}.cover .eyebrow{position:absolute;top:14px;left:14px;font-size:9px}.cover .title{font-size:18px;line-height:1.65;-webkit-line-clamp:4;margin:20px 0 0;letter-spacing:0}.cover img{height:auto;aspect-ratio:4/5;object-fit:cover;border-radius:13px}\n      .body{padding:9px 2px 0}.mobile-caption{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:14px;font-weight:650;line-height:1.55;overflow-wrap:anywhere;margin:0 0 6px}.with-image .mobile-caption{display:none}.image-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:14px;font-weight:650;line-height:1.55;margin:0 0 6px}.body>.summary{display:none}.person{gap:5px}.avatar{height:19px;width:19px;font-size:10px}.author{font-size:11px;color:#898991}.save{font-size:23px;padding:5px 0 5px 8px;min-width:32px;min-height:32px;color:#888}.meta{margin-top:2px;font-size:10px;color:#aaa;gap:3px}.latest{font-size:10px;color:#aaa;text-decoration:none}.preview{font-size:10px;color:#aa8893;margin-top:2px;padding:4px 0}.foot{display:none}.pager{margin-top:28px}\n      .grid.single .cover:not(.has-image){aspect-ratio:auto;min-height:155px}.grid.single .cover img{height:260px;aspect-ratio:auto;object-fit:contain;background:#f7f7f8}.grid.single .mobile-caption{font-size:16px}\n    }\n\n    .grid.masonry{grid-auto-rows:4px;row-gap:0}\n    .grid.masonry>.card{align-self:start;margin-bottom:18px}\n    .cover:not(.has-image){min-height:150px;padding:54px 24px 28px;justify-content:center}\n    .cover .eyebrow{position:absolute;top:18px;left:24px}\n    .cover .title{margin:0}\n    @media(max-width:600px){\n      .cover:not(.has-image){aspect-ratio:auto;min-height:132px;padding:50px 20px 24px}\n      .cover .eyebrow{top:16px;left:20px}\n      .cover .title{margin:0;line-height:1.55;-webkit-line-clamp:6}\n      .grid.single .cover:not(.has-image){min-height:110px}\n    }\n\n    .toolbar-menu{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;margin-left:auto;color:#555}\n    .settings-login,.settings-reading{font-size:12px;color:#a66d7d;min-height:36px;padding:7px 0}\n    .session-status{font-size:12px;color:#8b8b95;white-space:nowrap;min-height:36px;padding:7px 4px}\n    .cover.cached-cover{padding:0;min-height:0;background:#fff;justify-content:flex-start}\n    .cover.cached-cover:before{display:none}\n    .cover.cached-cover:after{display:none}\n    .cover.cached-cover>.cached-cover-image{position:static;inset:auto;z-index:auto;width:100%;height:auto;aspect-ratio:3/4;object-fit:cover;display:block;background:#f3f3f3}\n    .cover.cached-cover>.eyebrow{position:static;top:auto;left:auto;padding:10px 12px 0}\n    .cover.cached-cover .tag{background:#f1f1f4}\n    .cover.cached-cover>.title{position:static;z-index:auto;color:inherit;text-shadow:none;margin:5px 0 0;padding:0 12px 13px;font-size:15px;line-height:1.5;letter-spacing:0;-webkit-line-clamp:2}\n    .app.options-open .settings{display:flex}\n    .settings-login{text-align:left;max-width:180px}.settings-login .account-uid{font-size:10px}\n\n    .app.document-scroll{position:relative;inset:auto;min-height:100svh;overflow:visible;overscroll-behavior:auto;scrollbar-gutter:auto}\n    .document-scroll .top{transition:transform .2s ease}\n    .document-scroll.rt-chrome-hidden .top{transform:translateY(-100%)}\n    @media(prefers-reduced-motion:reduce){.document-scroll .top{transition:none}}\n";
  const node = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const safeURL = (raw, base = location.href) => {
    try { const u = new URL(raw, base); return /^(https?:)$/.test(u.protocol) ? u : null; } catch { return null; }
  };
  const link = (url, text, cls = '') => { const a = node('a', cls, text); a.href = url; return a; };
  const button = (text, cls, action) => { const b = node('button', cls, text); b.type = 'button'; b.addEventListener('click', action); return b; };
  const savePrefs = () => write(KEY, prefs);

  shadow.append(node('style', '', css));
  const app = node('div', 'app'); app.hidden = true;
  const top = node('header', 'top'), bar = node('div', 'bar');
  const brand = node('div', 'brand', '阅境 '); brand.append(node('span', '', '· NGA'));
  const search = node('div', 'search'), input = node('input');
  input.type = 'search'; input.placeholder = '搜索本页标题 / 作者'; input.setAttribute('aria-label', '搜索本页标题或作者');
  input.addEventListener('input', () => { query = input.value.trim().toLowerCase(); render(); });
  search.append(input);
  const mobileSearch = button('', 'mobile-tool', () => {
    const open = app.classList.toggle('search-open'); mobileSearch.setAttribute('aria-expanded', String(open));
    if (open) input.focus();
  }); mobileSearch.setAttribute('aria-label', '展开或收起搜索'); mobileSearch.setAttribute('aria-expanded', 'false');
  const mobileOptions = button('', 'mobile-tool toolbar-menu', () => {
    refreshAccount(); mobileOptions.setAttribute('aria-expanded', String(app.classList.toggle('options-open')));
  }); mobileOptions.setAttribute('aria-label', '展开或收起设置'); mobileOptions.setAttribute('aria-expanded', 'false');
  for (const [control, path] of [[mobileSearch, 'M21 21l-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0'], [mobileOptions, 'M5 6h14M5 12h14M5 18h14']]) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '21'); svg.setAttribute('height', '21'); svg.setAttribute('aria-hidden', 'true');
    shape.setAttribute('d', path); shape.setAttribute('fill', 'none'); shape.setAttribute('stroke', 'currentColor'); shape.setAttribute('stroke-width', '1.7'); shape.setAttribute('stroke-linecap', 'round');
    svg.append(shape); control.append(svg);
  }
  bar.append(brand, search, node('div', 'spacer'), mobileSearch, mobileOptions, button('切回原版', 'pill', () => toggle(false)));
  top.append(bar);
  const main = node('main'), intro = node('div', 'intro'), heading = node('div');
  const h1 = node('h1', '', '论坛发现'), subtitle = node('div', 'sub');
  heading.append(h1, subtitle);
  const settings = node('div', 'settings');
  for (const [prop, label] of [['single', '手机单列']]) {
    const wrap = node('label'), check = node('input'); check.type = 'checkbox'; check.checked = !!prefs[prop];
    check.addEventListener('change', () => { prefs[prop] = check.checked; savePrefs(); render(); });
    wrap.append(check, document.createTextNode(label)); settings.append(wrap);
  }
  function ngaPageContext(context) {
  return context === globalThis.window && typeof unsafeWindow !== 'undefined' ? unsafeWindow : context;
}

// NGA's CURRENT fields identify the session; userInfo contains every poster on the page.
function readCurrentAccount(context) {
  const { document } = context;
  const scripts = [...document.scripts].filter(script => !script.src);
  const page = ngaPageContext(context);
  let uid = page.__CURRENT_UID, username = page.__CURRENT_UNAME;
  const positiveUID = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? String(Number(value)) : null;
  function stringLiteral(raw) {
    return raw.slice(1, -1).replace(/\\(?:u([\da-f]{4})|x([\da-f]{2})|([\s\S]))/gi, (_, unicode, hex, escaped) => {
      if (unicode || hex) return String.fromCharCode(parseInt(unicode || hex, 16));
      return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '\n': '' })[escaped] ?? escaped;
    });
  }
  // Tampermonkey's isolated world may not expose page globals. Read the known
  // literal assignments from the original response instead of evaluating scripts.
  if (uid === undefined) for (const script of scripts) {
    const assignment = script.textContent.match(/\b__CURRENT_UID\s*=\s*(?:parseInt\(\s*(['"])(\d*)\1\s*,\s*10\s*\)|(\d+))/);
    if (assignment) { uid = assignment[2] ?? assignment[3]; break; }
  }
  uid = positiveUID(uid);
  if (!uid) return null;
  if (username === undefined) for (const script of scripts) {
    const assignment = script.textContent.match(/\b__CURRENT_UNAME\s*=\s*('(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*")/);
    if (assignment) { username = stringLiteral(assignment[1]); break; }
  }
  if (!username) username = page.commonui?.userInfo?.users?.[uid]?.username;
  if (!username) username = readNGAUserData(document, context).users[uid]?.username;
  return { uid, username: typeof username === 'string' || Object.prototype.toString.call(username) === '[object String]' ? String(username) : '当前用户' };
}

// Extract JSON data only; fetched NGA scripts are never executed.
function readNGAJSON(source, start) {
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try { return JSON.parse(source.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}
const ngaUserTables = new WeakMap();
function readNGAUserData(document, context) {
  const sources = [...document.scripts].filter(s => !s.src).map(s => s.textContent).filter(s => /userInfo\.setAll|__UCPUSER/.test(s));
  let cached = ngaUserTables.get(document);
  if (!cached || sources.length !== cached.sources.length || sources.some((source, i) => source !== cached.sources[i])) {
    const users = {}, groups = {};
    for (const source of sources) {
      for (const match of source.matchAll(/(?:commonui\.userInfo\.setAll\s*\(\s*|__UCPUSER\s*=\s*)\{/g)) {
        const data = readNGAJSON(source, match.index + match[0].length - 1);
        if (!data) continue;
        if (match[0].includes('__UCPUSER')) { if (data.uid) users[String(data.uid)] = data; }
        else { Object.assign(groups, data.__GROUPS); for (const [uid, user] of Object.entries(data)) if (/^\d+$/.test(uid)) users[uid] = user; }
      }
    }
    cached = { sources, users, groups }; ngaUserTables.set(document, cached);
  }
  const live = document === context?.document ? ngaPageContext(context).commonui?.userInfo : null;
  return { users: { ...cached.users, ...live?.users }, groups: { ...cached.groups, ...live?.groups } };
}

  function mountUserProfiles() {
  const cache = new Map(), requests = new Map();
  function avatarURL(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    let value = raw.split('|')[0].trim();
    const short = value.match(/^\.a\/(\d+)_(\d+)\.(jpg|png|gif|webp(?:\.jpg)?)(\?\d+)?$/);
    if (short) {
      const hex = Number(short[1]).toString(16).padStart(9, '0').slice(-9);
      const path = `${hex.slice(6)}/${hex.slice(3,6)}/${hex.slice(0,3)}`;
      value = `https://img.nga.cn/avatars/2002/${path}/${short[1]}_${short[2]}.${short[3]}${short[4] || ''}`;
    } else if (/^[\w-]+\.(?:gif|jpg|png|webp)$/.test(value)) value = `https://img4.nga.cn/ngabbs/face/${value}`;
    return safeURL(value, pageURL)?.href || null;
  }
  function normalize(user, groups = {}) {
    if (!user || !/^\d+$/.test(String(user.uid)) || Number(user.uid) <= 0) return null;
    const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
    return {
      uid: String(user.uid), username: String(user.username || '用户'), avatar: avatarURL(user.avatar),
      regdate: number(user.regdate), rank: user.group || groups[user.memberid]?.[0] || groups[user.groupid]?.[0] || null,
      rvrc: number(user.rvrc), money: number(user.money), posts: number(user.postnum ?? user.posts)
    };
  }
  function resolve(info) {
    const uid = String(info.uid || '');
    if (!/^\d+$/.test(uid) || Number(uid) <= 0) return null;
    const table = readNGAUserData(document, window);
    const user = info.profile || normalize(table.users[uid], table.groups);
    return user?.regdate != null ? user : cache.get(uid) || user || null;
  }
  function image(url, className) {
    const img = node('img', className); img.src = url; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => { img.remove(); }); return img;
  }
  function decorate(control, info, avatarOnly = false) {
    if (!info?.uid) { delete control.dataset.userUid; control.querySelector('.user-avatar-image')?.remove(); return; }
    control.dataset.userUid = info.uid; control.dataset.avatarOnly = String(avatarOnly);
    const user = resolve(info), url = user?.avatar;
    control.setAttribute('aria-label', `${info.author || info.username || user?.username || '用户'}，查看用户资料`);
    if (control.querySelector('.user-avatar-image')?.getAttribute('src') === url) return;
    control.querySelector('.user-avatar-image')?.remove();
    if (url) control.prepend(image(url, `user-avatar-image${avatarOnly ? '' : ' account-picture'}`));
  }
  async function load(uid) {
    if (requests.has(uid)) return requests.get(uid);
    const request = (async () => {
      const url = new URL('/nuke.php', pageURL); url.searchParams.set('func', 'ucp'); url.searchParams.set('uid', uid);
      const controller = new window.AbortController(); const timer = window.setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(url.href, { credentials: 'same-origin', signal: controller.signal });
        if (!response.ok || (response.url && new URL(response.url).origin !== pageURL.origin)) throw new Error('用户资料暂时无法读取');
        const buffer = await response.arrayBuffer();
        const charset = /charset=\s*([\w-]+)/i.exec(response.headers.get('content-type') || '')?.[1] || 'gb18030';
        const html = new window.TextDecoder(charset).decode(buffer);
        const doc = new window.DOMParser().parseFromString(html, 'text/html');
        const table = readNGAUserData(doc, window), user = normalize(table.users[uid], table.groups);
        if (!user || user.uid !== uid) throw new Error('原页未提供该用户资料');
        cache.set(uid, user);
        for (const control of shadow.querySelectorAll('[data-user-uid]')) if (control.dataset.userUid === uid) decorate(control, {uid, author:user.username, profile:user}, control.dataset.avatarOnly === 'true');
        return user;
      } finally { window.clearTimeout(timer); }
    })();
    requests.set(uid, request);
    try { return await request; } finally { requests.delete(uid); }
  }
  const style = node('style', '', `
    .user-trigger{padding:0;text-align:left;touch-action:manipulation}.avatar,.reader-avatar{position:relative;overflow:hidden}
    .avatar .user-avatar-image,.reader-avatar .user-avatar-image{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit}
    .account-picture{float:left;width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:7px}
    .user-card{position:fixed;z-index:2147483013;width:min(340px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;margin:0;padding:18px;border:1px solid #eee4e9;border-radius:20px;background:#fff8fa;color:#30272d;box-shadow:0 8px 40px #21132130;font:14px/1.6 system-ui}
    .user-card:not([open]){display:none}.user-card[data-theme=dark]{background:#29232a;color:#f3e4ed;border-color:#806d78}.user-card[data-theme=paper]{background:#faf5eb;color:#3c332d}
    .user-card-head{display:flex;align-items:center;gap:12px;padding-right:36px}.user-card-avatar{position:relative;overflow:hidden;width:64px;height:64px;border-radius:16px;background:#f5dce5;color:#a43d60;display:grid;place-items:center;font-size:24px;flex:none}.user-card-avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.user-card-name{font-size:17px;font-weight:650;overflow-wrap:anywhere}.user-card-uid{font-size:12px;opacity:.65}.user-card-close{position:absolute;right:10px;top:8px;min-width:40px;min-height:40px;font-size:23px}
    .user-card-details{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}.user-card-details div{min-width:0}.user-card-details dt{font-size:12px;opacity:.6}.user-card-details dd{margin:2px 0 0;overflow-wrap:anywhere}.user-card-details .wide{grid-column:1/-1}.user-card-status{font-size:12px;opacity:.65;margin:12px 0}.user-card-link{display:inline-block;padding:9px 14px;background:#f5dce5;color:#a43d60;border-radius:20px;font-size:12px}
  `);
  const panel = node('dialog', 'user-card'); panel.setAttribute('aria-label', '用户资料');
  const close = button('×', 'user-card-close', hide); close.setAttribute('aria-label', '关闭用户资料');
  const head = node('div', 'user-card-head'), portrait = node('div', 'user-card-avatar'), identity = node('div');
  const name = node('div', 'user-card-name'), uidLabel = node('div', 'user-card-uid'); identity.append(name, uidLabel); head.append(portrait, identity);
  const details = node('dl', 'user-card-details'), status = node('p', 'user-card-status'); status.setAttribute('role', 'status');
  const native = link('', '查看原版个人资料 ↗', 'user-card-link'); native.dataset.readscapeNative = 'true';
  panel.append(close, head, details, status, native); shadow.append(style, panel);
  let opener, generation = 0;
  function hide() { generation++; if (panel.open) { if (panel.close) panel.close(); else panel.removeAttribute('open'); } if (opener?.isConnected) opener.focus({preventScroll:true}); }
  function render(info, user) {
    name.textContent = user?.username || info.author || info.username || '用户'; uidLabel.textContent = info.uid ? `UID ${info.uid}` : '原页未提供 UID';
    portrait.replaceChildren(document.createTextNode(name.textContent.slice(0,1))); if (user?.avatar) portrait.append(image(user.avatar, ''));
    details.replaceChildren();
    function field(label, value, wide = false) { if (value === null || value === undefined || value === '') return; const group = node('div', wide ? 'wide' : ''); group.append(node('dt','',label),node('dd','',String(value))); details.append(group); }
    if (user?.regdate && !Number.isNaN(new Date(user.regdate*1000).getTime())) field('注册时间', new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(user.regdate*1000)), true);
    field('级别', user?.rank); field('威望', user?.rvrc == null ? null : user.rvrc / 10); field('发帖数', user?.posts);
    if (user?.money != null) { const amount = Math.max(0,Math.floor(user.money)), gold = Math.floor(amount/10000), silver = Math.floor(amount%10000/100), copper = amount%100; field('财富',[gold ? `${gold} 金币` : '',silver ? `${silver} 银币` : '',copper || !amount ? `${copper} 铜币` : ''].filter(Boolean).join(' ')); }
    native.hidden = !/^\d+$/.test(String(info.uid || '')) || Number(info.uid) <= 0;
    if (!native.hidden) { const url = new URL('/nuke.php',pageURL); url.searchParams.set('func','ucp'); url.searchParams.set('uid',info.uid); native.href=url.href; }
  }
  function position() {
    const rect = opener?.getBoundingClientRect(), width = panel.offsetWidth, height = panel.offsetHeight;
    const left = Math.max(12,Math.min(rect?.left || 12,window.innerWidth-width-12));
    const below = (rect?.bottom || 0)+8;
    const top = Math.max(12,Math.min(below,window.innerHeight-height-12));
    panel.style.left=`${left}px`; panel.style.top=`${top}px`;
  }
  async function show(info, trigger) {
    const token = ++generation; opener=trigger; panel.dataset.theme=prefs.theme || 'light';
    let user=resolve(info); render(info,user); status.textContent=''; status.hidden=true;
    if (!panel.open) { if (panel.show) panel.show(); else panel.setAttribute('open',''); }
    position(); close.focus({preventScroll:true});
    if (!info.uid || !/^\d+$/.test(String(info.uid)) || Number(info.uid)<=0) { status.hidden=false; status.textContent='原页未提供该用户的详细资料'; return; }
    if (!user || user.regdate === null) {
      status.hidden=false; status.textContent='正在读取用户资料…';
      try { user=await load(String(info.uid)); if (token !== generation || !panel.open) return; render(info,user); status.hidden=true; position(); }
      catch { if (token !== generation || !panel.open) return; status.textContent='暂时无法读取详细资料，可查看原版个人资料。'; }
    }
  }
  const dismiss = event => { if (panel.open && !event.composedPath().includes(panel) && !event.composedPath().includes(opener)) hide(); };
  const escape = event => { if (panel.open && event.key==='Escape') { event.preventDefault(); hide(); } };
  document.addEventListener('pointerdown',dismiss,true); document.addEventListener('keydown',escape,true);
  panel.addEventListener('cancel',event=>{event.preventDefault();hide();});
  window.addEventListener('pagehide',()=>{document.removeEventListener('pointerdown',dismiss,true);document.removeEventListener('keydown',escape,true);});
  return {show,decorate,normalize,avatarURL};
}

  const userProfiles = mountUserProfiles();
  const currentAccount = () => readCurrentAccount(window);
  const openLogin = trigger => {
    const account = currentAccount();
    if (account) {
      userProfiles.show({ ...account, author: account.username }, trigger?.nodeType === 1 ? trigger : shadow.activeElement || accountButton); return;
    }
    const login = [...document.querySelectorAll('a,button')].find(el => !el.closest('.postcontent, [id^=postcontent]') && /^(登录|登陆)$/.test(el.textContent.trim()));
    modeToggle(false);
    if (login) login.click();
  };
  const accountButton = button('登录', 'settings-login', () => openLogin(accountButton));
  const accountStatus = button('未登录', 'session-status', () => openLogin(accountStatus));
  accountStatus.setAttribute('aria-label', '未登录，登录 NGA');
  bar.insertBefore(accountStatus, mobileOptions);
  settings.append(accountButton, button('阅读设置', 'settings-reading', () => readingSettings.open()), button('原版页面 ↗', 'settings-native', () => toggle(false)));
  intro.append(heading, settings);
  const tabs = node('nav', 'tabs'); tabs.setAttribute('aria-label', '帖子筛选'); tabs.setAttribute('role', 'tablist');
  for (const [id, label] of [['all', '全部'], ['hot', '热议'], ['saved', '收藏']]) {
    const b = button(label, '', () => { tab = id; render(); }); b.dataset.tab = id; b.setAttribute('role', 'tab'); tabs.append(b);
  }
  const grid = node('section', 'grid'); grid.setAttribute('aria-label', '帖子卡片');
  const empty = node('div', 'empty'), pager = node('nav', 'pager'); pager.setAttribute('aria-label', '论坛分页');
  main.append(intro, tabs, grid, empty, pager, node('div', 'foot', '按原站顺序追加 · 热议为已加载帖子回复 ≥ 100 · 收藏仅存本浏览器'));
  app.append(top, main);
  const restore = button('卡片模式', 'restore', () => toggle(true)); restore.hidden = true;
  shadow.append(app, restore); document.documentElement.append(host);
  readingSettings = mountSettings({ context: window, shadow, app, prefs, cache: postCache, save: savePrefs, change: () => { if (prefs.smoothNavigation === false) navigation.finish(); settingsRefresh(); settings.querySelectorAll('input').forEach(c => { c.checked = !!prefs['single']; }); }, original: () => modeToggle(false), login: openLogin });
  let accountSignature;
  function refreshAccount() {
    const account = currentAccount(), signature = JSON.stringify(account);
    if (signature === accountSignature) return;
    accountSignature = signature; accountButton.replaceChildren();
    if (account) {
      accountButton.append(node('span', 'account-name', account.username), node('span', 'account-uid', `UID ${account.uid}`));
      accountButton.setAttribute('aria-label', `${account.username}，UID ${account.uid}，查看个人资料`);
    } else { accountButton.textContent = '未登录 · 登录'; accountButton.setAttribute('aria-label', '未登录，登录 NGA'); }
    accountStatus.hidden = !!account;
    readingSettings.setAccount(account);
    userProfiles.decorate(shadow.querySelector('.rt-account'), account ? { ...account, author: account.username } : null);
    userProfiles.decorate(accountButton, account ? { ...account, author: account.username } : null);
    accountChanged(account);
  }
  refreshAccount();
  const accountObserver = new MutationObserver(refreshAccount);
  accountObserver.observe(document.body, {childList:true,subtree:true,characterData:true});
  const accountTimer = window.setInterval(refreshAccount, 1000);
  window.addEventListener('pagehide', () => { accountObserver.disconnect(); window.clearInterval(accountTimer); });
  readingSettings.visibility(false);
  const viewportObserver = new MutationObserver(() => {
    if (!app.hidden && (viewport.content !== 'width=device-width, initial-scale=1, viewport-fit=cover' || document.head.firstElementChild !== viewport)) setViewport(true);
  });
  viewportObserver.observe(document.head, {childList:true,subtree:true,attributes:true,attributeFilter:['content']});
  window.addEventListener('pagehide', () => viewportObserver.disconnect());

  // 仅点击 NGA 已提供的普通跳转链接；不调用未公开接口，不点击登录或验证按钮。
  // sessionStorage 跨刷新计数：同一板块两分钟最多尝试两次，防止跳转循环。
  function autoContinue() {
    if (gateHandled || document.title !== '访客不能直接访问') return;
    const target = [...document.querySelectorAll('a')].find(a => /如不能自动跳转\s*[，,]?\s*可点此链接/.test(a.textContent));
    if (!target) return;
    gateHandled = true;
    if (prefs.enabled !== false && prefs.smoothNavigation !== false) navigation.show();
    const notice = node('div', '', '正在点击 NGA 的跳转链接…');
    notice.style.cssText = 'position:fixed;bottom:20px;left:16px;right:16px;max-width:460px;z-index:2147483001;padding:13px 16px;background:#fff;color:#555;border:1px solid #eee;border-radius:12px;box-shadow:0 4px 20px #0001;font-size:13px;line-height:1.6';
    shadow.append(notice);
    const retryKey = `${KEY}-continue-${pageURL.searchParams.get('stid') || pageURL.searchParams.get('fid') || `tid-${pageURL.searchParams.get('tid') || 'list'}`}`;
    let state;
    try {
      state = JSON.parse(sessionStorage.getItem(retryKey) || 'null');
      if (!state || Date.now() - state.start > 120000) state = { start: Date.now(), count: 0 };
      if (state.count >= 2) { navigation.finish(); notice.textContent = '自动跳转已尝试两次。请使用原页登录或手动点击链接。'; return; }
      state.count++;
      sessionStorage.setItem(retryKey, JSON.stringify(state));
    } catch {
      navigation.finish(); notice.textContent = '浏览器不允许记录跳转次数，请手动点击原页链接。'; return;
    }
    gateTimer = setTimeout(() => {
      if (!target.isConnected || document.title !== '访客不能直接访问') { notice.remove(); return; }
      // 使用原链接 onclick（当前页面为 g()），而非猜测/重写跳转地址。
      target.click();
      setTimeout(() => {
        if (items.length || document.title !== '访客不能直接访问') notice.remove();
        else notice.textContent = '已点击原生跳转链接；若仍停留在此页，请登录后访问。';
      }, 5000);
    }, 1200);
  }

  function toggle(enabled) {
    const readingPosition = getReadingScroll();
    prefs.enabled = enabled; savePrefs();
    app.hidden = !enabled || !items.length;
    restore.hidden = enabled || !items.length;
    setViewport(!app.hidden);
    setSurface(!app.hidden, readingPosition);
    readingSettings?.visibility(!app.hidden);
    if (!app.hidden) navigation.finish();
    if (app.hidden) cardObserver?.disconnect(); else render();
  }
  const usesDocumentScroll = () => document.documentElement.hasAttribute('data-readscape-document-scroll');
  const getReadingScroll = () => usesDocumentScroll() ? window.scrollY : app.scrollTop;
  function setReadingScroll(top) {
    if (usesDocumentScroll()) { if (window.scrollY !== top) window.scrollTo({left:0,top}); }
    else app.scrollTop = top;
  }
  function scrollReadingTo(options) { (usesDocumentScroll() ? window : app).scrollTo(options); }
  function setSurface(enabled, savedPosition) {
    const wasActive = document.documentElement.hasAttribute('data-readscape-active'), wasDocument = usesDocumentScroll();
    const position = wasActive ? savedPosition ?? getReadingScroll() : readingScroll;
    if (enabled && !wasActive) nativeScroll = { left: window.scrollX, top: window.scrollY };
    if (!enabled && wasActive) readingScroll = position;
    const documentScroll = enabled && !!mobileViewport?.matches;
    document.documentElement.toggleAttribute('data-readscape-active', enabled);
    document.documentElement.toggleAttribute('data-readscape-document-scroll', documentScroll);
    app.classList.toggle('document-scroll', documentScroll);
    document.documentElement.style.overflow = enabled ? documentScroll ? 'auto' : 'hidden' : originalOverflow;
    if (enabled && (!wasActive || documentScroll !== wasDocument)) {
      app.classList.remove('rt-chrome-hidden');
      setReadingScroll(position);
    }
    if (!enabled && nativeScroll) {
      if (window.scrollX !== nativeScroll.left || window.scrollY !== nativeScroll.top) window.scrollTo(nativeScroll);
      nativeScroll = null;
    }
  }
  const updateScrollMode = () => { if (!app.hidden) { setSurface(true); observeListEnd(); } };
  mobileViewport?.addEventListener('change', updateScrollMode);
  let chromeScroll = 0;
  const updateReadingChrome = () => {
    if (!usesDocumentScroll() || document.documentElement.hasAttribute('data-readscape-reader-open')) return;
    const top = window.scrollY, delta = top - chromeScroll;
    if (top < 90 || Math.abs(delta) >= 12) {
      app.classList.toggle('rt-chrome-hidden', top >= 90 && delta > 0 && !app.classList.contains('options-open'));
      chromeScroll = top;
    }
  };
  window.addEventListener('scroll', updateReadingChrome, {passive:true});
  window.addEventListener('pagehide', () => { mobileViewport?.removeEventListener('change', updateScrollMode); window.removeEventListener('scroll', updateReadingChrome); });
  function setViewport(enabled) {
    if (enabled) {
      viewport.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
      if (!viewport.isConnected) document.head.append(viewport);
      // 原站可能晚于脚本写入第二个 viewport，以最先声明的阅读视口为准。
      if (document.head.firstElementChild !== viewport) document.head.prepend(viewport);
    } else if (!originalViewport) viewport.remove();
    else if (originalViewportContent == null) viewport.removeAttribute('content');
    else viewport.setAttribute('content', originalViewportContent);
  }
  if (window.top === window.self && typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('切换 NGA 阅读 / 原版', () => modeToggle(!prefs.enabled));
  }

    const firstListPage = Math.max(1, Number(pageURL.searchParams.get('page')) || 1);
  const listPages = new Map();
  let listCursor = firstListPage, listNext = null, listBusy = false, listFailed = false, listHydrated = false, listController;
  const listLoad = button('加载下一页', 'pill list-load', () => loadNextListPage());
  const listStatus = node('span', 'list-status'); listStatus.setAttribute('role', 'status');

  function listKey(raw) {
    const u = safeURL(raw);
    if (!u || u.origin !== pageURL.origin || u.pathname !== '/thread.php') return null;
    u.searchParams.delete('page'); u.searchParams.delete('rand'); u.searchParams.sort(); u.hash = '';
    return u.href;
  }
  const streamKey = listKey(pageURL.href);
  function validListURL(raw, number) {
    const u = safeURL(raw);
    return u && listKey(u.href) === streamKey && Number(u.searchParams.get('page') || 1) === number ? u.href : null;
  }
  function nextListURL(doc, number, base) {
    for (const a of doc.querySelectorAll('a[href*="thread.php"]')) {
      if (!/^(?:\d+|后页|下一页|>|»)$/.test(a.textContent.trim().replace(/\p{M}/gu, ''))) continue;
      const next = validListURL(safeURL(a.getAttribute('href'), base)?.href, number + 1);
      if (next) return next;
    }
    return null;
  }
  function cacheListPages() {
    if (streamKey) postCache?.saveListPages(streamKey, listPages);
  }
  async function hydrateListPages() {
    if (listHydrated || !postCache) return;
    listHydrated = true;
    const generation = postCache.generation;
    const cache = await postCache.getListPages(streamKey);
    if (!cache || generation !== postCache.generation || coverDisposed || listBusy || listCursor !== firstListPage || listPages.size !== 1) return;
    let next = listPages.get(firstListPage)?.next;
    while (next) {
      const number = listCursor + 1;
      const page = cache.find(p => p.number === number && validListURL(p.url, number));
      if (!page || !page.items.length || !page.items.every(validCachedItem) || page.next && !validListURL(page.next, number + 1)) break;
      listPages.set(number, { url:page.url, items:page.items, next:page.next }); listCursor = number; next = page.next;
    }
    if (listPages.size > 1) { listNext = listPages.get(listCursor).next; mergeListPages(); render(); }
  }
  function validCachedItem(item) {
    if (!item || typeof item.tid !== 'string' || !/^\d+$/.test(item.tid) || typeof item.title !== 'string' || typeof item.author !== 'string' || typeof item.time !== 'string') return false;
    const u = safeURL(item.url), latest = item.latest && safeURL(item.latest);
    return u?.origin === pageURL.origin && u.pathname === '/read.php' && u.searchParams.get('tid') === item.tid &&
      (!item.latest || latest?.origin === pageURL.origin && latest.pathname === '/read.php' && latest.searchParams.get('tid') === item.tid);
  }
  function mergeListPages() {
    const seen = new Set(); items = [];
    for (const page of listPages.values()) for (const item of page.items) {
      if (seen.has(item.tid)) continue;
      seen.add(item.tid); items.push(item);
    }
  }
  function updateListPage(found) {
    for (const item of found) item.lastAccess = Date.now();
    listPages.set(firstListPage, { url: pageURL.href, items: found, next: nextListURL(document, firstListPage, pageURL.href) });
    listNext = listPages.get(listCursor).next;
    mergeListPages(); cacheListPages(); hydrateListPages();
  }
  function updateListControls() {
    listLoad.disabled = listBusy;
    listLoad.hidden = !listNext;
    listLoad.textContent = listBusy ? '正在加载…' : listFailed ? '重试下一页' : '加载下一页';
    if (!listNext && items.length) listStatus.textContent = '已经到底了';
  }
  async function loadNextListPage() {
    if (listBusy || !listNext || app.hidden) return;
    const url = listNext, number = listCursor + 1;
    listBusy = true; listFailed = false; updateListControls(); listStatus.textContent = `正在读取第 ${number} 页…`;
    const controller = listController = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!validListURL(response.url || url, number)) throw new Error('原站返回了其他页面');
      const bytes = new Uint8Array(await response.arrayBuffer()), initial = new TextDecoder('utf-8').decode(bytes);
      const encoding = response.headers.get('content-type')?.match(/charset\s*=\s*([\w-]+)/i)?.[1] || initial.slice(0,4096).match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || 'utf-8';
      const doc = new DOMParser().parseFromString(new TextDecoder(encoding).decode(bytes), 'text/html');
      const found = extract(doc, url);
      for (const item of found) item.lastAccess = Date.now();
      if (!found.length) throw new Error('需要原站跳转、登录，或页面结构不支持');
      if (controller.signal.aborted) return;
      if (!found.some(item => !items.some(existing => existing.tid === item.tid))) {
        listNext = null; listStatus.textContent = '原站未返回新帖子，已停止重复加载。'; return;
      }
      listNext = nextListURL(doc, number, url);
      listPages.set(number, { url, items: found, next: listNext }); listCursor = number;
      mergeListPages(); cacheListPages(); render();
      listStatus.textContent = listNext ? `已加载第 ${number} 页` : '已经到底了';
    } catch (error) {
      listFailed = true;
      listStatus.replaceChildren(node('span', '', `${error.name === 'AbortError' ? '加载超时' : error.message}。 `), link(url, '在原站打开'));
      listStatus.querySelector('a').dataset.readscapeNative = 'true';
    } finally { clearTimeout(timeout); listBusy = false; updateListControls(); observeListEnd(); }
  }
  function observeListEnd() {
    listObserver?.disconnect();
    if (typeof window.IntersectionObserver !== 'function' || !streamKey) return;
    listObserver = new window.IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && !listFailed && tab === 'all' && !query && !document.documentElement.hasAttribute('data-readscape-reader-open')) loadNextListPage();
    }, { root: usesDocumentScroll() ? null : app, rootMargin: '0px 0px 600px 0px' });
    listObserver.observe(pager);
  }


  // 封面直接引用原图地址，由浏览器 HTTP 缓存承担复用；缓存只记录地址。
  function applyCachedCover(card, tid) {
    if (!postCache || card.coverLoading) return;
    card.coverLoading = true;
    const generation = postCache.generation;
    postCache.getCover(tid).then(cached => {
      if (!cached || coverDisposed || generation !== postCache.generation || !card.isConnected) return;
      const cover = card.querySelector('.cover');
      if (!cover || card.coverSource === cached.source) return;
      const image = node('img'); image.alt = ''; image.decoding = 'async'; image.loading = 'lazy';
      // 已有比例时先占位，避免图片加载后卡片高度变化导致滚动中点击偏移。
      if (cached.width > 0 && cached.height > 0) image.style.aspectRatio = `${cached.width} / ${cached.height}`;
      image.onload = () => {
        if (coverDisposed || generation !== postCache.generation) return;
        cover.querySelector('.cached-cover-image')?.remove();
        // 保留图片自身宽高比，瀑布流按实际高度排布；加载完成前用 3:4 占位。
        if (image.naturalWidth > 0 && image.naturalHeight > 0) image.style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
        image.className = 'cached-cover-image'; cover.prepend(image); cover.classList.add('cached-cover'); card.coverSource = cached.source;
      };
      image.src = cached.source;
    }).catch(() => {}).finally(() => { card.coverLoading = false; });
  }
  const unsubscribeCache = postCache?.subscribe(event => {
    if (event.type === 'cover') { const card = listCards.get(event.tid)?.card; if (card) applyCachedCover(card, event.tid); }
    if (event.type === 'clear') {
      for (const {card} of listCards.values()) { card.querySelector('.cached-cover-image')?.remove(); card.querySelector('.cover')?.classList.remove('cached-cover'); card.coverSource = null; }
    }
    if (event.type === 'favorites') postCache.getFavorites().then(saved => {
      if (!saved || coverDisposed) return;
      for (const tid of Object.keys(favorites)) if (!saved[tid]) delete favorites[tid]; Object.assign(favorites,saved);
      if (!app.classList.contains('reader') && items.length) render(false);
    });
  });
  postCache?.getFavorites().then(saved => {
    if (!saved || coverDisposed) return;
    for (const [tid,item] of Object.entries(saved)) if (!favoriteChanges.has(tid)) favorites[tid] = item;
    if (!app.classList.contains('reader') && items.length) render(false);
  });
  window.addEventListener('pagehide', event => { if (event.persisted) return; coverDisposed = true; unsubscribeCache?.(); });

  function extract(doc = document, base = pageURL.href) {
    const result = [], seen = new Set();
    // 优先常见 NGA topic 类，同时兼容 table / li 列表；不依赖数字化动态 ID。
    for (const a of [...doc.querySelectorAll('a.topic, a[id^="t_tt"], .c2 > a[href*="read.php"]'), ...doc.querySelectorAll('a[href*="read.php"]')]) {
      if (a.matches('.replydate,.replies,.reply') || a.closest('.c1,.c4,[id^="t_pc"]')) continue;
      const u = safeURL(a.getAttribute('href'), base);
      if (!u || u.origin !== location.origin || !/\/read\.php$/.test(u.pathname)) continue;
      const tid = u.searchParams.get('tid');
      if (!tid || !/^\d+$/.test(tid) || seen.has(tid)) continue;
      if (+u.searchParams.get('page') > 1 && !a.classList.contains('topic')) continue;
      const title = a.textContent.trim();
      if (title.length < 3 || /^[\d\s.>…]+$/.test(title) || /^(?:(?:今天|昨天|前天)\s*\d{1,2}:\d{2}|\d+\s*(?:分钟前|小时前)|\d{2}-\d{2}\s+\d{1,2}:\d{2})$/.test(title)) continue;
      const row = a.closest('tr, .topicrow, .topic-row, li');
      if (!row) continue;
      seen.add(tid);
      const users = [...row.querySelectorAll('a[href*="uid="], a.author')];
      const replyEl = row.querySelector('.replies, .reply, .c1');
      const firstCell = row.querySelector('td');
      const numeric = [replyEl?.textContent, firstCell?.textContent].map(x => (x || '').trim()).find(x => /^\d[\d,]*$/.test(x)) || '';
      const replies = /^\d[\d,]*$/.test(numeric) ? Number(numeric.replaceAll(',', '')) : null;
      const cells = [...row.querySelectorAll('td')];
      const last = cells.at(-1);
      const author = users[0]?.textContent.trim() || row.querySelector('.author')?.textContent.trim() || '';
      const timeMatch = (last?.textContent || '').match(/(?:\d+\s*分钟前|\d+\s*小时前|(?:今天|昨天|前天)\s*\d{1,2}:\d{2}|\d{2}-\d{2}\s+\d{1,2}:\d{2})/);
      const pageLinks = [...row.querySelectorAll('a[href*="read.php"]')].map(x => safeURL(x.getAttribute('href'), base)).filter(x => x?.origin === u.origin && x.searchParams.get('tid') === tid);
      const replyURL = safeURL(row.querySelector('a.replydate')?.getAttribute('href') || '', base);
      const lastURL = replyURL?.origin === u.origin && replyURL.searchParams.get('tid') === tid ? replyURL : pageLinks.sort((x, y) => Number(y.searchParams.get('page') || 1) - Number(x.searchParams.get('page') || 1))[0];
      u.searchParams.delete('page'); u.hash = '';
      const authorURL = safeURL(users[0]?.getAttribute('href') || '', base);
      const uid = authorURL?.searchParams.get('uid') || null;
      result.push({ tid, title, author, uid, replies, time: timeMatch?.[0] || '', url: u.href, latest: lastURL?.href || '', pinned: /置顶/.test(title) || /(?:^|\s)(?:top|sticky)(?:\s|$)/i.test(row.className) });
    }
    return result;
  }

  function scan() {
    autoContinue();
    const found = extract();
    const sig = JSON.stringify(found);
    if (sig === signature) return;
    signature = sig;
    if (!found.length && !items.length) {
      app.hidden = restore.hidden = true;
      readingSettings.visibility(false);
      setSurface(false);
      setViewport(false);
      return;
    }
    if (found.length) updateListPage(found);
    const board = [...document.querySelectorAll('a[href*="thread.php"]')].find(a => {
      const u = safeURL(a.getAttribute('href'));
      return u && u.searchParams.get('stid') === pageURL.searchParams.get('stid') && a.textContent.trim().length > 3;
    });
    h1.textContent = board?.textContent.trim() || document.title.replace(/\s*[-_].*NGA.*$/i, '') || '论坛发现';
    toggle(!!prefs.enabled);
    renderPager();
  }

  function renderPager() {
    pager.replaceChildren();
    pager.append(listLoad, listStatus, button('原版翻页', 'pill', () => toggle(false)));
    updateListControls();
  }

  const palette = ['#f5e7df', '#e5ebdf', '#e7e8f3', '#f5e5e8', '#e0edef', '#f2eddf'];
  const color = tid => palette[Number(tid.slice(-4)) % palette.length];
  const count = n => n == null ? '讨论' : n >= 10000 ? `${(n / 10000).toFixed(1)}万回复` : `${n} 回复`;

  function render(cacheVisit = true) {
    grid.classList.toggle('single', !!prefs.single);
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    // 收藏包含曾浏览过的其他页；全部与热议保持已加载页面的原始顺序。
    const source = tab === 'saved' ? Object.values(favorites) : items;
    const visible = source.filter(item => (tab !== 'hot' || item.replies >= 100) && (!query || `${item.title} ${item.author}`.toLowerCase().includes(query)));
    if (cacheVisit) postCache?.visit(visible);
    subtitle.textContent = `第 ${firstListPage}${listPages.size > 1 ? `–${listCursor}` : ''} 页 · ${visible.length} 篇${query ? ' · 已加载搜索' : ''}`;
    empty.textContent = tab === 'saved' ? '点击卡片上的 ♡ 收藏帖子。' : '没有符合条件的帖子。';
    empty.hidden = visible.length > 0;
    const retained = new Set(visible.map(item => item.tid));
    for (const card of [...grid.children]) if (!retained.has(card.dataset.tid)) { cardObserver?.unobserve(card); card.remove(); }
    for (const [index, item] of visible.entries()) {
      const { lastAccess, updatedAt, contentHtml, coverId, ...appearance } = item;
      const signature = JSON.stringify(appearance);
      let entry = listCards.get(item.tid);
      if (!entry || entry.signature !== signature) {
        const card = makeCard(item);
        if (entry?.card.isConnected) { cardObserver?.unobserve(entry.card); entry.card.replaceWith(card); }
        entry = { card, signature }; listCards.set(item.tid, entry);
      }
      const fav = entry.card.querySelector('.save'), saved = !!favorites[item.tid];
      fav.textContent = saved ? '♥' : '♡'; fav.setAttribute('aria-pressed', String(saved));
      if (grid.children[index] !== entry.card) grid.insertBefore(entry.card, grid.children[index] || null);
      if (!entry.card.coverSource) applyCachedCover(entry.card, item.tid);
    }
    // 保留 DOM 中的原站顺序，按实际高度跨网格行，避免短卡片下方留白。
    if (typeof window.ResizeObserver === 'function') {
      cardObserver ||= new window.ResizeObserver(entries => {
        for (const { target } of entries) {
          const span = Math.ceil((target.getBoundingClientRect().height + 18) / 4);
          target.style.gridRowEnd = `span ${Math.max(1, span)}`;
        }
      });
      grid.classList.add('masonry');
      for (const card of grid.children) cardObserver.observe(card);
    }
    updateListControls();
  }

  function makeCard(item) {
    const card = node('article', 'card'); card.dataset.tid = item.tid; card.style.setProperty('--bg', color(item.tid));
    const cover = link(item.url, '', 'cover');
    const eye = node('div', 'eyebrow', 'NGA · 讨论');
    if (item.pinned) eye.append(node('span', 'tag', '置顶'));
    else if (item.replies >= 100) eye.append(node('span', 'tag', '热议'));
    cover.append(eye, node('div', 'title', item.title));
    const body = node('div', 'body');
    const person = node('div', 'person');
    const avatar = button(item.author.slice(0, 1) || 'N', 'avatar user-trigger', () => userProfiles.show(item, avatar));
    const author = button(item.author || '作者未识别', 'author user-trigger', () => userProfiles.show(item, author));
    userProfiles.decorate(avatar, item, true);
    person.append(avatar, author);
    const saved = !!favorites[item.tid];
    const fav = button(saved ? '♥' : '♡', 'save', () => {
      if (favorites[item.tid]) delete favorites[item.tid]; else favorites[item.tid] = { ...item };
      favoriteChanges.add(item.tid); postCache?.setFavorite(item, !!favorites[item.tid]);
      const state = !!favorites[item.tid]; fav.textContent = state ? '♥' : '♡'; fav.setAttribute('aria-pressed', String(state));
      if (tab === 'saved') render();
    });
    fav.setAttribute('aria-label', '收藏帖子'); fav.setAttribute('aria-pressed', String(saved)); person.append(fav);
    const meta = node('div', 'meta'); meta.append(node('span', '', count(item.replies)), node('span', '', item.time));
    if (item.latest && item.latest !== item.url && new URL(item.latest).searchParams.has('page')) meta.append(link(item.latest, '最新回复', 'latest'));
    body.append(person, meta); card.append(cover, body);
    return card;
  }

    // Convert NGA's inert response DOM without running its inline scripts.
  function normalizeNGAContent(source, base) {
    const root = source.cloneNode(false), stack = [{ el: root }];
    const current = () => stack.at(-1).el;
    const finish = entry => {
      if (entry.tag === 'img') {
        let raw = entry.el.textContent.trim();
        if (raw.startsWith('./mon_')) raw = `https://img.nga.cn/attachments/${raw.slice(2)}`;
        const u = safeURL(raw, base);
        if (u) { const img = node('img'); img.src = u.href; entry.el.replaceWith(img); }
      } else if (entry.tag === 'url') {
        const u = safeURL(entry.arg || entry.el.textContent.trim(), base);
        if (u) entry.el.setAttribute('href', u.href);
      }
    };
    const text = value => {
      const tokens = /\[(\/?)([a-z]+)(?:([=:])([^\]]*))?\]/gi;
      let offset = 0, match;
      while ((match = tokens.exec(value))) {
        current().append(document.createTextNode(value.slice(offset, match.index))); offset = tokens.lastIndex;
        const [literal, closing, name, separator, arg = ''] = match, tag = name.toLowerCase();
        const code = stack.findLastIndex(e => e.tag === 'code' || e.tag === 'pre');
        if (code > 0 && !(closing && stack[code].tag === tag)) { current().append(document.createTextNode(literal)); continue; }
        if (closing) {
          const index = stack.findLastIndex(e => e.tag === tag);
          if (index > 0) { while (stack.length > index) finish(stack.pop()); }
          else current().append(document.createTextNode(literal));
          continue;
        }
        let el;
        if (tag === 's' && separator === ':') {
          const parts = arg.split(':'), group = parts.length > 1 ? parts.shift() : '0', smile = parts.join(':');
          const file = ngaPageContext(window).ubbcode?.smiles?.[group]?.[smile];
          if (typeof file === 'string' && /^[\w.-]+$/.test(file)) {
            el = node('img', 'smile'); el.src = `https://img4.nga.cn/ngabbs/post/smile/${file}`; el.alt = literal;
          } else el = node('span', 'emoji', ({goodjob:'👍',哭笑:'😂',咦:'🤔',晕:'😵',赞同:'👍',满足:'😊'})[smile] || '🙂');
          current().append(el); continue;
        }
        const tags = {b:'b',i:'i',u:'u',s:'s',del:'del',code:'code',pre:'pre',quote:'blockquote',collapse:'details',url:'a',img:'span',uid:'a',pid:'a',size:'span',color:'span',font:'span',align:'div',list:'ul',li:'li'};
        if (!tags[tag]) { current().append(document.createTextNode(literal)); continue; }
        el = node(tags[tag]);
        if (tag === 'quote') el.className = 'quote';
        if (tag === 'collapse') el.append(node('summary', '', arg || '展开内容'));
        if (tag === 'uid' && /^\d+$/.test(arg)) { el.className = 'userlink'; el.setAttribute('href', new URL(`/nuke.php?func=ucp&uid=${arg}`,base).href); }
        if (tag === 'pid' && /^\d+,\d+(?:,\d+)?$/.test(arg)) {
          const [pid,tid,page] = arg.split(','), u = new URL('/read.php',base);
          u.searchParams.set('tid',tid); u.searchParams.set('topid',pid); if (page) u.searchParams.set('page',page);
          el.className = 'pid-reference'; el.setAttribute('href',u.href);
        }
        current().append(el); stack.push({el,tag,arg});
      }
      current().append(document.createTextNode(value.slice(offset)));
    };
    const walk = child => {
      if (child.nodeType === 3) { text(child.textContent); return; }
      if (child.nodeType !== 1 || child.matches('script,style,iframe,object,embed')) return;
      const el = child.cloneNode(false); current().append(el);
      if (['BR','IMG','HR'].includes(child.tagName)) return;
      const entry = {el, tag: ['CODE','PRE'].includes(child.tagName) ? child.tagName.toLowerCase() : undefined}; stack.push(entry);
      for (const nested of child.childNodes) walk(nested);
      const index = stack.indexOf(entry);
      if (index >= 0) while (stack.length > index) finish(stack.pop());
    };
    for (const child of source.childNodes) walk(child);
    while (stack.length > 1) finish(stack.pop());
    for (const header of root.querySelectorAll('b,strong')) {
      if (/^Reply to\b/i.test(header.textContent.trim()) && header.querySelector('.pid-reference')) header.classList.add('reply-reference');
    }
    return root;
  }

    function startReader() {
    const tid = pageURL.searchParams.get('tid');
    postCache?.visit({ tid, url: pageURL.href });
    const pages = new Map(), records = new Map(), cards = new Map(), nextPages = new Map();
    let previousCards = new Map();
    let initialSignature = '', busy = false, ended = false, scanTimer, cursor;
    const nativePage = Number(pageURL.searchParams.get('page')) || 1;
    cursor = nativePage;
    const canonical = (page = nativePage) => {
      const u = new URL(pageURL.href);
      ['rand', 'topid', 'pid'].forEach(k => u.searchParams.delete(k));
      u.searchParams.set('page', String(page)); u.hash = ''; return u;
    };
    const style = node('style', '', "\n      .reader .bar{max-width:1000px}.reader .brand{font-size:20px}.reader main{max-width:1000px;padding:32px 24px}\n      .reader h1{font-size:30px;line-height:1.5;letter-spacing:-.7px;overflow-wrap:anywhere}.reader-head{margin-bottom:22px}.reader-head .sub{margin-top:9px}\n      .reader-page{margin-bottom:28px}.page-heading{display:flex;align-items:center;gap:10px;color:#999;font-size:12px;margin:24px 0 14px}.page-heading:after{content:'';height:1px;background:#e8e8ed;flex:1}\n      .comment{padding:22px 24px;border:1px solid #ececf0;border-radius:18px;background:white;margin-bottom:12px;scroll-margin-top:105px;overflow:hidden}.comment.op{border-color:#f0e2db;margin:0 0 30px;padding:28px;background:#fffefa}.comment.flash{outline:3px solid #ff7994}\n      .comment-head{display:flex;align-items:center;gap:10px;margin-bottom:13px}.reader-avatar{height:34px;width:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--bg);color:#807570;font-size:13px;flex:none}.reader-author{font-size:13px;font-weight:700;overflow-wrap:anywhere}.comment-date{font-size:11px;color:#a0a0aa;margin-top:2px}.floor{font-size:11px;color:#a0a0aa;margin-left:auto;white-space:nowrap}.op-label{background:#ffede5;color:#b16e4e;font-size:10px;padding:2px 6px;border-radius:6px;margin-left:6px}\n      .comment-content{font-size:15px;line-height:1.95;overflow-wrap:anywhere;color:#414148}.comment-content p{margin:10px 0}.comment-content>p:first-child{margin-top:0}.reader{--content-link:#356b91;--content-link-visited:#785f91;--content-link-hover:#245477;--content-link-bg:#edf4fa}\n      .reader.rt-paper{--content-link:#396787;--content-link-visited:#78618b;--content-link-hover:#274e6a;--content-link-bg:#eaece7}\n      .reader.rt-dark{--content-link:#8fc8f0;--content-link-visited:#c3abe0;--content-link-hover:#b7deff;--content-link-bg:#293b4b}\n      .comment-content .content-link{color:var(--content-link);text-decoration-line:underline;text-decoration-color:color-mix(in srgb,var(--content-link) 40%,transparent);text-decoration-thickness:1px;text-underline-offset:.2em;text-decoration-skip-ink:auto;border-radius:3px;overflow-wrap:anywhere;transition:color .15s,background-color .15s}\n      .comment-content .content-link:visited{color:var(--content-link-visited)}\n      .comment-content .content-link:hover{color:var(--content-link-hover);background:var(--content-link-bg);text-decoration-color:currentColor}\n      .comment-content .content-link:focus-visible{outline:2px solid var(--content-link);outline-offset:3px;background:var(--content-link-bg)}\n      .comment-content .external-link:after{content:' ↗';display:inline-block;font-size:.8em;text-decoration:none;white-space:nowrap}\n      .comment-content img{max-width:100%;height:auto;border-radius:10px;display:block;margin:12px auto}.comment-content img.emoji{display:inline-block;width:auto;height:1.65em;max-width:3em;object-fit:contain;vertical-align:-.4em;margin:0 .2em;border-radius:0}\n      .reader.rt-dark .comment-content img.emoji{background:#f7f7f9;border-radius:4px}\n      .comment-content pre{overflow:auto;padding:12px;background:#f5f5f7;border-radius:10px;font-size:12px;white-space:pre}.comment-content code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}.comment-content table{display:block;overflow:auto;border-collapse:collapse;max-width:100%}.comment-content td,.comment-content th{border:1px solid #e7e7ec;padding:5px 10px}.comment-content hr{border:0;border-top:1px solid #eee}\n      .quoted{background:#f7f7f9;border-radius:10px;margin:10px 0 16px;border-left:3px solid #e6d0d7;padding:9px 13px;color:#85858f;font-size:12px}.quoted>summary{cursor:pointer;line-height:1.7;overflow-wrap:anywhere}.quoted-body{padding-top:10px;color:#777;line-height:1.8}.quoted .context{display:inline-block;margin-top:9px;font-size:11px;color:#b77886}.quoted .quoted{background:#eeeef2}\n      .comment-actions{display:flex;gap:15px;align-items:center;flex-wrap:wrap;margin-top:14px;font-size:11px;color:#9a9aa5}.comment-actions button{padding:4px 0;color:#aa7582}.thread{border-left:2px solid #ede5e8;margin:0 0 18px 25px;padding-left:15px}.thread>summary{font-size:12px;color:#a67986;padding:7px 0 14px;cursor:pointer}.thread .comment{padding:18px 20px}\n      .reader-bottom{text-align:center;margin:26px 0}.load-next{background:#ff2442;color:white;padding:12px 28px;border-radius:24px;font-size:13px}.reader-status{margin:13px auto;color:#999;font-size:12px;max-width:600px}.reader-status a{color:#ae7482;text-decoration:underline}.reader-footer{font-size:11px;color:#aaa;margin:14px 0}.reply-rel{font-size:11px;color:#b38390;margin-bottom:10px}\n\n      @media(max-width:600px){.reader main{padding:22px 12px}.reader h1{font-size:23px}.reader .bar{gap:10px;flex-wrap:nowrap}.reader .brand{font-size:17px}.reader .bar>.pill{font-size:11px;padding:8px 10px}.reader .top{padding:calc(10px + env(safe-area-inset-top)) 12px 10px}.reader .comment{padding:17px 16px;border-radius:14px}.reader .comment.op{padding:20px 17px}.comment-content{font-size:15px;line-height:1.85}.reader-avatar{width:29px;height:29px}.thread{margin-left:12px;padding-left:9px}.thread .comment{padding:15px 13px}.comment{scroll-margin-top:85px}}\n      .action-date{display:none}.reader-identity{min-width:0;flex:1}.attachment{display:block}\n      @media(max-width:600px){\n        .reader{background:white;padding-bottom:calc(30px + env(safe-area-inset-bottom))}.reader .top{border-bottom:1px solid #f3f3f5;padding:calc(8px + env(safe-area-inset-top)) 16px 8px}.reader .bar{gap:8px;min-width:0}.reader .brand{background:none;color:#555;font-size:15px;letter-spacing:0;padding:0;flex:1;overflow:hidden}.reader .bar>.pill{display:block;margin:0;padding:10px 8px;min-height:42px;background:none;color:#999;border-radius:0;font-size:11px}.reader main{padding:22px 18px 28px}.reader h1{font-size:21px;font-weight:700;line-height:1.6;letter-spacing:0}.reader-head{margin-bottom:20px}.reader-head .sub{font-size:11px;margin-top:8px}\n        .page-heading{margin:22px 0 5px;font-size:11px;color:#b2b2ba}.page-heading:after{background:#f3f3f5}\n        .reader .comment{position:relative;border:0;border-radius:0;background:transparent;padding:20px 0 22px 44px;margin:0;overflow:visible}.comment-head{gap:8px;align-items:flex-start;margin-bottom:6px}.reader .reader-avatar{position:absolute;left:0;top:19px;width:32px;height:32px;font-size:12px}.reader-author{font-size:13px;font-weight:500;color:#8a8a93;line-height:1.65}.floor{font-size:10px;color:#bbb;padding-top:3px}.comment-head .comment-date{display:none}.comment-content{font-size:15px;line-height:1.8;color:#333;letter-spacing:.1px}.op-label{background:#f5f5f7;color:#999;font-size:10px;padding:2px 5px;font-weight:400}\n        .reader .comment.op{padding:8px 0 23px;margin-bottom:10px;border-bottom:1px solid #eee}.comment.op .comment-head{padding-left:44px;margin-bottom:16px;min-height:36px;align-items:center}.reader .comment.op .reader-avatar{top:8px;width:34px;height:34px}.comment.op .reader-author{color:#555;font-size:14px}.comment.op .comment-content{font-size:16px;line-height:1.85}.comment.op .comment-actions{margin-top:13px}.comment-content .attachment{display:block}.comment-content .attachment img{width:auto;max-width:100%;max-height:300px;object-fit:contain;margin:12px 0;border-radius:8px}.comment.op .attachment img{max-height:none}\n        .comment-actions{gap:12px;margin-top:9px;font-size:11px;color:#aaa;line-height:1.6}.comment-actions .action-date{display:block;flex-basis:100%;font-size:11px;color:#b0b0b8}.comment-actions button{color:#999;min-height:30px;padding:3px 0}.comment-actions a{color:#aaa}.quoted{border:0;background:#f7f7f9;padding:9px 11px;border-radius:7px;margin:9px 0 12px;font-size:11px;color:#92929c}.quoted>summary{line-height:1.75}.quoted-body{font-size:12px;line-height:1.85}.quoted .context{min-height:32px;padding:4px 0;color:#8e7180}.reply-rel{font-size:11px;color:#aaa;line-height:1.7;margin:0 0 7px}\n        .thread{border:0;margin:0 0 9px 44px;padding:0}.thread>summary{list-style:none;color:#58728e;font-size:12px;font-weight:500;padding:0 0 16px;min-height:40px}.thread>summary::-webkit-details-marker{display:none}.thread>summary:before{content:'—';color:#c9d1db;margin-right:9px}.thread[open]>summary:after{content:' · 收起';font-size:11px;font-weight:400;color:#9aa8b8}.reader .thread .comment{padding:13px 0 17px 34px;margin:0}.reader .thread .reader-avatar{width:25px;height:25px;top:14px;font-size:10px}.thread .reader-author{font-size:12px}.thread .comment-content{font-size:14px}.thread .quoted{font-size:10px}.reader-bottom{margin:26px 0 12px}.load-next{background:#f7f7f9;color:#7d6b76;border-radius:20px;font-size:12px;padding:12px 25px;min-height:42px}.reader-footer{display:none}\n        .reader-status{font-size:11px;line-height:1.8}\n      }\n      @media(max-width:360px){.reader main{padding-left:14px;padding-right:14px}.reader .comment{padding-left:39px}.thread{margin-left:39px}.reader .thread .comment{padding-left:30px}}\n          /* 图片卡片：先保留画布，再淡入原图；失败时仍可重试或打开原图。 */\n      .reader-image{display:block;position:relative;width:100%;max-width:720px;margin:16px auto;overflow:hidden;border:1px solid #ececf0;border-radius:12px;background:#f5f5f7;box-shadow:0 2px 8px #22222206}\n      .reader-image .attachment{position:relative;display:block;aspect-ratio:var(--image-ratio,4 / 3);overflow:hidden;cursor:zoom-in;color:#999;text-decoration:none}\n      .reader-image .attachment img{display:block;width:100%;height:100%;max-height:none;object-fit:contain;margin:0;border-radius:0;opacity:0;transition:opacity .25s ease}\n      .reader-image.is-loaded .attachment img{opacity:1}.image-state{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:#93939d;pointer-events:none}\n      .is-loading .attachment:before{content:'';position:absolute;inset:0;background:linear-gradient(100deg,transparent 25%,#fff9 50%,transparent 75%);background-size:200% 100%;animation:image-shimmer 1.8s ease-in-out infinite}.is-loaded .image-state{display:none}\n      .image-retry{position:absolute;left:50%;top:calc(50% + 22px);transform:translateX(-50%);padding:8px 15px;border:1px solid #dedee4;border-radius:18px;background:white;font-size:12px;color:#666;min-height:36px}\n      @keyframes image-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}\n      .reader .comment.op{padding:0;background:#fff;border:1px solid #eee;border-radius:20px;overflow:hidden;margin-bottom:26px}\n      .comment.op>.comment-head{padding:22px 24px;margin:0}.note-copy{padding:0 24px 12px;min-width:0}.reader .note-title{font-size:23px;line-height:1.5;letter-spacing:0;margin:0 0 14px}.comment.op>.comment-actions{margin:0;padding:0 24px 22px}\n      .note-gallery{position:relative;min-width:0;background:#f5f5f7}.gallery-track{display:flex;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;scrollbar-width:none;aspect-ratio:4 / 5;max-height:680px}.gallery-track::-webkit-scrollbar{display:none}.gallery-slide{flex:0 0 100%;min-width:0;scroll-snap-align:start;scroll-snap-stop:always;display:flex}\n      .gallery-slide .reader-image{width:100%;max-width:none;height:100%;margin:0;border:0;border-radius:0;box-shadow:none}.gallery-slide .attachment{width:100%;height:100%;aspect-ratio:auto}.gallery-count{position:absolute;right:16px;top:16px;padding:4px 10px;border-radius:16px;background:#0006;color:white;font-size:12px;font-variant-numeric:tabular-nums;pointer-events:none}\n      .gallery-prev,.gallery-next{position:absolute;top:50%;transform:translateY(-50%);background:#ffffffdf;border-radius:50%;width:36px;height:36px;font-size:26px;line-height:1;box-shadow:0 2px 12px #0001}.gallery-prev{left:12px}.gallery-next{right:12px}.gallery-prev:disabled,.gallery-next:disabled{visibility:hidden}\n      .gallery-dots{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);display:flex;max-width:80%;overflow:auto;gap:2px;padding:2px 6px;border-radius:20px;background:#ffffffbf}.gallery-dot{flex:none;width:20px;height:20px;padding:6px}.gallery-dot:after{content:'';display:block;width:6px;height:6px;border-radius:50%;background:#c9c9cf}.gallery-dot[aria-pressed=true]:after{background:#ff2442}\n      .image-viewer{position:fixed;inset:0;width:100vw;height:100dvh;max-width:none;max-height:none;margin:0;border:0;padding:0;background:#171719;color:#fff;z-index:2147483002;overflow:hidden;color-scheme:dark}.image-viewer:not([open]){display:none}.image-viewer::backdrop{background:#000b}\n      .viewer-bar{position:absolute;z-index:2;top:0;left:0;right:0;display:flex;align-items:center;gap:20px;padding:calc(12px + env(safe-area-inset-top)) 20px 12px;background:#171719dd;font-size:13px}.viewer-count{flex:1}.viewer-close,.viewer-original{padding:10px;min-height:44px;color:#fff}.viewer-stage{display:flex;align-items:center;justify-content:center;height:100%;padding:80px 64px 40px}.viewer-stage .reader-image{max-width:100%;width:auto;max-height:100%;margin:0;border:0;background:transparent;box-shadow:none}.viewer-stage .attachment{max-height:calc(100dvh - 120px);cursor:zoom-out}.viewer-stage .attachment img{width:auto;height:auto;max-width:100%;max-height:calc(100dvh - 120px);object-fit:contain}.viewer-stage .is-loading,.viewer-stage .is-error{width:min(80vw,800px)}\n      .viewer-prev,.viewer-next{position:absolute;z-index:2;top:50%;width:44px;height:44px;border-radius:50%;background:#ffffff1a;color:#fff;font-size:30px}.viewer-prev{left:12px}.viewer-next{right:12px}\n      @media(min-width:801px){.comment.op.has-gallery{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);grid-template-rows:auto 1fr auto}.has-gallery>.note-gallery{grid-column:1;grid-row:1 / 4;align-self:start}.has-gallery>.comment-head{grid-column:2;grid-row:1}.has-gallery>.note-copy{grid-column:2;grid-row:2}.has-gallery>.comment-actions{grid-column:2;grid-row:3}.has-gallery .gallery-track{max-height:none}}\n      @media(max-width:800px){.note-gallery{margin-bottom:22px}.reader .comment.op{border-radius:16px}.gallery-track{max-height:75dvh}}\n      @media(max-width:600px){\n        .reader main{padding-top:12px}.reader .comment.op{margin:0 -18px 20px;padding:0 0 20px;border:0;border-bottom:1px solid #eee;border-radius:0;background:white}.comment.op>.comment-head{padding:10px 18px 14px 62px;min-height:58px;margin:0}.reader .comment.op .reader-avatar{left:18px;top:11px;width:34px;height:34px}.note-copy{padding:0 18px 8px}.reader .note-title{font-size:20px;line-height:1.55;margin-bottom:12px}.comment.op>.comment-actions{padding:0 18px;margin:0}.note-gallery{margin-bottom:22px}.gallery-track{max-height:70dvh}.gallery-prev,.gallery-next{width:32px;height:32px}.reader .reader-image .attachment img{width:100%;height:100%;max-height:none;margin:0;border-radius:0}.reader-image{margin:12px 0;border-radius:10px}.viewer-stage{padding:80px 12px 50px}.viewer-bar{gap:8px;padding-left:12px;padding-right:12px}.viewer-original{font-size:12px}.viewer-prev,.viewer-next{top:auto;bottom:calc(12px + env(safe-area-inset-bottom));width:40px;height:40px}\n      }\n      @media(max-width:360px){.reader .comment.op{margin-left:-14px;margin-right:-14px}}\n      @media(prefers-reduced-motion:reduce){.is-loading .attachment:before{animation:none}.reader-image .attachment img{transition:none}}\n      .comment:not(.op) .reader-image .attachment{max-height:360px}.comment-content p:empty{display:none}\n      @media(max-width:600px){.comment:not(.op) .reader-image .attachment{max-height:300px}}\n      .reader.rt-dark .comment.op{background:#202329;border-color:#34373e}.reader.rt-dark .note-gallery,.reader.rt-dark .reader-image{background:#2c3038;border-color:#34373e}.reader.rt-dark .comment.op .reader-author{color:#ddd}.reader.rt-paper .note-gallery,.reader.rt-paper .reader-image{background:#f0ece4}.reader .note-title{font-size:calc(23px * var(--rt-scale,1))}\n      @media(max-width:600px){.reader .note-title{font-size:calc(20px * var(--rt-scale,1))}}\n      .reader-end{display:flex;align-items:center;justify-content:center;gap:14px;max-width:280px;margin:24px auto;color:#96939c;font-size:13px}.reader-end:before,.reader-end:after{content:'';height:1px;flex:1;background:currentColor;opacity:.2}\n      @media(max-width:600px){.reader .comment-actions button,.reader .comment-actions a,.reader .load-next{min-height:48px}.reader .comment-actions{gap:4px 8px}.reader .comment-actions button,.reader .comment-actions a{display:inline-flex;align-items:center;padding:8px 10px;border-radius:24px}.reader .comment-actions button:active,.reader .comment-actions a:active:active{background:#e8e1e8}.reader .load-next{min-width:160px;border-radius:24px;background:#f5e4ea;color:#8c3650;font-weight:600}}\n\n      /* 短回复随内容收缩，原站入口集中在右上角楼层号。 */\n      .comment-actions{margin-top:6px}\n      .reader .floor{display:inline-flex;align-items:center;justify-content:flex-end;min-width:36px;min-height:32px;padding:0 2px}\n      @media(max-width:600px){\n        .reader .comment:not(.op){padding-top:12px;padding-bottom:12px}\n        .reader .comment:not(.op) .reader-avatar{top:12px}\n        .reader .comment-head{margin-bottom:3px;align-items:center;min-height:28px}\n        .reader .comment-actions{margin-top:4px}\n        .reader .comment-content{line-height:1.7}\n        .reader .comment-content p{margin:6px 0}\n        .reader .comment-content>p:first-child{margin-top:0}\n        .reader .comment-content>p:last-child{margin-bottom:0}\n      }\n");
    shadow.append(style);
    app.classList.add('reader');
    const rtop = node('header', 'top'), rbar = node('div', 'bar');
    const rrestore = button('优雅阅读', 'restore', () => setMode(true)); rrestore.hidden = true;
    const rmain = node('main'), rhead = node('div', 'reader-head');
    const rtitle = node('h1', '', document.title.replace(/\s*NGA玩家社区.*$/, ''));
    const rsub = node('div', 'sub', '按原站分页阅读 · 引用默认折叠');
    rhead.append(rtitle, rsub);
    rbar.append(node('div', 'brand', 'NGA · 阅读'), node('div', 'spacer'), accountStatus);
    const readerMenu = mobileOptions.cloneNode(true);
    readerMenu.setAttribute('aria-label', '阅读设置与账号'); readerMenu.removeAttribute('aria-expanded');
    readerMenu.onclick = () => readingSettings.open(readerMenu); rbar.append(readerMenu);
    rtop.append(rbar);
    const stream = node('div', 'reader-stream');
    const bottom = node('div', 'reader-bottom'), status = node('div', 'reader-status'); status.setAttribute('role', 'status');
    const endMarker = node('div', 'reader-end', '已经到底了');
    const load = button('加载下一页', 'load-next', async () => {
      if (busy || ended || load.hidden) return;
      while (pages.has(cursor + 1)) cursor++;
      const next = cursor + 1;
      await loadPage(next, true);
      if (pages.has(next)) cursor = next;
      renderReader();
    });
    const footer = node('div', 'reader-footer');
    bottom.append(load, endMarker, status, footer);
    rmain.append(rhead, stream, bottom); app.replaceChildren(rtop, rmain);
    const [replyEntry, dockCount] = readingSettings.setActions([
      { label: '回复帖子', className: 'reply-entry', href: () => postURL(document, location.href).href, target: '_blank' },
      { label: '评论', className: 'dock-count', action: () => stream.querySelector('.comment:not(.op)')?.scrollIntoView({ block: 'start', behavior: 'smooth' }) },
      { label: '回到顶部', className: 'dock-top', action: () => scrollReadingTo({ top: 0, behavior: 'smooth' }) }
    ]);
    accountChanged = info => {
      replyEntry.hidden = !info;
      footer.textContent = info ? '每次只加载一页 · 回复与引用在新标签页打开原版发帖页' : '每次只加载一页';
      for (const card of cards.values()) syncCommentActions(card, card.readerPost, !!info);
    };
    accountChanged(currentAccount());
    restore.remove(); shadow.append(rrestore);
    modeToggle = setMode;
    settingsRefresh = renderReader;

    function setMode(enabled) {
      const readingPosition = getReadingScroll();
      if (!enabled) closeViewer();
      prefs.enabled = enabled; savePrefs();
      app.hidden = !enabled || !pages.size; rrestore.hidden = enabled || !pages.size;
      setViewport(!app.hidden);
      setSurface(!app.hidden, readingPosition);
      readingSettings?.visibility(!app.hidden);
      if (!app.hidden) navigation.finish();
    }

    function postURL(doc, base, post, action = 'reply') {
      const links = [...doc.querySelectorAll('a[href]')].filter(a => !a.closest('.postcontent,[id^=postcontent],.quote,blockquote'));
      const candidates = links.map(a => safeURL(a.getAttribute('href'), base)).filter(u => u?.origin === pageURL.origin && u.pathname === '/post.php' && u.searchParams.get('tid') === tid && ['reply','quote'].includes(u.searchParams.get('action')));
      let url = post ? candidates.find(u => u.searchParams.get('pid') === post.pid && u.searchParams.get('action') === action) || candidates.find(u => u.searchParams.get('pid') === post.pid) : candidates.find(u => !u.searchParams.has('pid') && u.searchParams.get('action') === 'reply');
      if (!url && post) {
        // NGA may create its toolbar lazily. Reuse its button URL template too,
        // without invoking the touch handler that opens an inline editor.
        const page = ngaPageContext(window), template = page.commonui?.postBtn?.d?.[action === 'quote' ? 7 : 8]?.u;
        const nativeArg = doc === document ? page.commonui?.postArg?.data?.[post.index] : null;
        const fields = {fid:nativeArg?.fid ?? page.__CURRENT_FID,tid,pid:post.pid,i:post.index};
        if (typeof template === 'string' && !template.match(/\{([^}]+)\}/g)?.some(key => fields[key.slice(1,-1)] == null)) {
          const candidate = safeURL(template.replace(/\{([^}]+)\}/g, (_, key) => encodeURIComponent(fields[key])), base);
          if (candidate?.origin === pageURL.origin && candidate.pathname === '/post.php' && candidate.searchParams.get('tid') === tid) url = candidate;
        }
      }
      url = url ? new URL(url) : new URL('/post.php', base);
      if (url.searchParams.get('action') !== action) url.searchParams.set('action', action);
      if (url.searchParams.get('tid') !== tid) url.searchParams.set('tid', tid);
      if (!url.searchParams.has('_newui')) url.searchParams.set('_newui', '');
      if (!url.searchParams.has('fid')) {
        const nativeReply = [...doc.querySelectorAll('a[href]')].map(a => safeURL(a.getAttribute('href'),base)).find(u => u?.origin === pageURL.origin && u.pathname === '/post.php' && u.searchParams.get('tid') === tid && u.searchParams.has('fid'));
        const literal = [...doc.scripts].map(s=>s.textContent).join('\n').match(/\b__CURRENT_FID\s*=\s*(-?\d+)/)?.[1];
        const fid = nativeReply?.searchParams.get('fid') || literal || (doc === document ? ngaPageContext(window).__CURRENT_FID : postURL(document, location.href).searchParams.get('fid'));
        if (fid != null) url.searchParams.set('fid', String(fid));
      }
      if (post) { if (post.pid != null && url.searchParams.get('pid') !== post.pid) url.searchParams.set('pid',post.pid); if (!url.searchParams.has('article')) url.searchParams.set('article',post.index); }
      return url;
    }
    function postLink(url, label, cls = '') {
      const a = link(url, label, cls); a.dataset.readscapeNative = 'true'; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
    }
    function parsePosts(doc, base) {
      const output = [], localSeen = new Set(), userData = readNGAUserData(doc, window);
      for (const rawContent of doc.querySelectorAll('.postcontent, [id^="postcontent"]')) {
        const content = normalizeNGAContent(rawContent, base);
        if (!/^postcontent\d+$/.test(content.id) && !content.classList.contains('postcontent')) continue;
        const index = content.id.match(/(\d+)$/)?.[1];
        const row = rawContent.closest('tr') || doc.getElementById(`post1strow${index}`);
        const container = rawContent.closest('[id^="postcontainer"]') || row;
        if (!row || !container) continue;
        const floorLink = [...row.querySelectorAll('a')].find(a => /^#\d+$/.test(a.textContent.trim()));
        const floorAnchor = container.querySelector('a[name^=l]')?.getAttribute('name')?.match(/^l(\d+)$/);
        const floor = floorLink ? Number(floorLink.textContent.trim().slice(1)) : floorAnchor ? Number(floorAnchor[1]) : null;
        const anchor = container.querySelector('a[id^="pid"][id$="Anchor"]');
        const pid = anchor?.id.match(/^pid(\d+)Anchor$/)?.[1] || null;
        const key = pid != null ? `pid:${pid}` : floor != null ? `floor:${floor}` : `index:${index}:${base}`;
        if (localSeen.has(key)) continue; localSeen.add(key);
        const authorLinks = [...row.querySelectorAll(`[id=postauthor${index}], .author`)];
        const author = authorLinks.find(a => a.textContent.trim()) || authorLinks[0];
        const authorURL = author && safeURL(author.getAttribute('href'), base);
        const uid = authorURL?.searchParams.get('uid') || author?.getAttribute('data-uid') || author?.getAttribute('data-user-id') || row.querySelector('[name=uid]')?.textContent.trim() || (doc === document ? ngaPageContext(window).commonui?.postArg?.data?.[index]?.pAid : null) || author?.getAttribute('onclick')?.match(/userClick\([^,]+,\s*['"](\d+)['"]/)?.[1] || null;
        const userID = uid == null ? null : String(uid);
        const profile = userID && userProfiles.normalize(userData.users[userID] || {uid:userID,username:author?.textContent.trim() || `UID ${uid}`}, userData.groups);
        const nativeAvatar = row.querySelector(`[id=posteravatar${index}], img.avatar`);
        if (profile && !profile.avatar) profile.avatar = userProfiles.avatarURL(nativeAvatar?.getAttribute('src'));
        const date = doc.getElementById(`postdate${index}`) || row.querySelector('.postdatec');
        const original = new URL(base); original.hash = pid ? `pid${pid}Anchor` : `l${floor ?? index}`;
        const quotes = [...content.querySelectorAll('.quote, blockquote, .reply-reference')].filter(q => !q.parentElement?.closest('.quote, blockquote, .reply-reference'));
        const refs = quotes.map(q => {
          const a = [...q.querySelectorAll('a[href]')].find(a => {
            const u = safeURL(a.getAttribute('href'), base); return u?.origin === pageURL.origin && u.searchParams.get('tid') === tid && u.searchParams.has('topid');
          });
          const u = a && safeURL(a.getAttribute('href'), base);
          return u ? { pid: u.searchParams.get('topid'), url: u.href, author: q.querySelector('.userlink')?.textContent.trim() || '' } : null;
        }).filter(Boolean);
        output.push({ key, pid, floor, replyURL: postURL(doc, base, {row,pid,index}).href, quoteURL: postURL(doc, base, {row,pid,index}, 'quote').href, author: profile?.username || author?.textContent.trim() || '匿名用户', uid:userID, profile, time: date?.textContent.trim() || '', content, refs, original: original.href, base, native: doc === document ? container : null });
      }
      return output;
    }

    function detectNextPage(doc, page, base) {
      const metadata = [...doc.scripts].map(s => s.textContent).join('\n').match(/var\s+__PAGE\s*=\s*\{0:[^,]+,1:(\d+),2:(\d+),3:(\d+)/);
      if (metadata && Number(metadata[3]) > 0) return page < Math.ceil((Number(metadata[1]) + 1) / Number(metadata[3]));
      const pagers = [...doc.querySelectorAll('#pagebtop, #pagebbtm')];
      // 没有分页信息的响应仍可手动加载；空分页栏是 NGA 单页帖的结构。
      if (!pagers.length) return null;
      return pagers.some(pager => [...pager.querySelectorAll('a[href]')].some(a => {
        const u = safeURL(a.getAttribute('href'), base);
        return u?.origin === pageURL.origin && u.pathname === pageURL.pathname && u.searchParams.get('tid') === tid &&
          (Number(u.searchParams.get('page')) > page || u.searchParams.get('page') === 'e');
      }));
    }

    function updateNative() {
      autoContinue();
      const posts = parsePosts(document, location.href);
      if (!posts.length) return;
      const sig = posts.map(p => `${p.key}|${p.author}|${JSON.stringify(p.profile)}|${p.replyURL}|${p.quoteURL}|${p.time}|${p.content.outerHTML}`).join('\n') +
        [...document.querySelectorAll('#pagebtop, #pagebbtm')].map(el => el.outerHTML).join('');
      if (sig === initialSignature) return; initialSignature = sig;
      const detectedPage = [...document.querySelectorAll('#pagebtop .invert, #pagebbtm .invert')].map(x => Number(x.textContent.replace(/\p{M}/gu, '').trim())).find(x => x > 0);
      const p = detectedPage || (pageURL.searchParams.get('page') === 'e' && posts[0].floor != null ? Math.floor(posts[0].floor / 20) + 1 : nativePage);
      const firstRender = !pages.size;
      if (firstRender) cursor = p;
      nextPages.set(p, detectNextPage(document, p, location.href));
      pages.set(p, posts); rebuildRecords();
      rtitle.textContent = document.querySelector('#postsubject0')?.textContent.trim() || document.title.replace(/\s*NGA玩家社区.*$/, '');
      cachePage(p,posts,nextPages.get(p));
      if (!rbar.querySelector('a')) {
        const board = [...document.querySelectorAll('#m_nav a[href*="thread.php"]')].at(-1);
        const u = board && safeURL(board.getAttribute('href'));
        if (u) rbar.insertBefore(link(u.href, '返回板块', 'pill'), rbar.lastChild);
      }
      renderReader(); setMode(!!prefs.enabled);
      const targetPid = pageURL.hash.match(/pid(\d+)/)?.[1];
      if (firstRender && targetPid) setTimeout(() => focusRecord(`pid:${targetPid}`), 50);
    }

    function rebuildRecords() {
      records.clear(); for (const list of pages.values()) for (const p of list) records.set(p.key, p);
    }

    function cachePage(number, posts, next) {
      if (!postCache) return;
      const generation = postCache.generation;
      const replies = posts.map(p => { const {content,native,...record} = p; return {...record,html:content.outerHTML}; });
      postCache.saveReplyPage(tid,number,replies,{next,title:rtitle.textContent,url:canonical(number).href}).then(async stored => {
        if (!stored || generation !== postCache.generation || !await postCache.getReplyPage(tid,number)) return;
      });
    }
    function restorePage(cached) {
      if (!cached || cached.tid !== tid || !Array.isArray(cached.replies)) return [];
      return cached.replies.map(p => {
        const base = safeURL(p.base);
        if (!base || base.origin !== pageURL.origin || base.searchParams.get('tid') !== tid || typeof p.html !== 'string' || typeof p.author !== 'string' || typeof p.key !== 'string') return null;
        if (!['replyURL','quoteURL','original'].every(key => { const u=safeURL(p[key]); return u?.origin===pageURL.origin && u.searchParams.get('tid')===tid && ['/post.php','/read.php'].includes(u.pathname); })) return null;
        const content = new DOMParser().parseFromString(p.html,'text/html').body.firstElementChild;
        if (!content || !content.matches('.postcontent,[id^=postcontent]')) return null;
        const refs=(Array.isArray(p.refs)?p.refs:[]).filter(ref=>{const u=safeURL(ref.url);return u?.origin===pageURL.origin&&u.searchParams.get('tid')===tid;});
        return {...p,refs,content,native:null};
      }).filter(Boolean);
    }

    // 图片保留原图入口；加载、失败与查看器都在 Shadow DOM 内处理。
    let viewerReturnFocus, viewerItems = [], viewerIndex = 0;
    const viewer = node('dialog', 'image-viewer');
    viewer.setAttribute('aria-label', '图片查看器');
    const viewerBar = node('div', 'viewer-bar'), viewerCount = node('span', 'viewer-count');
    const viewerOriginal = link('', '打开原图 ↗', 'viewer-original');
    viewerOriginal.target = '_blank'; viewerOriginal.rel = 'noopener noreferrer';
    const viewerClose = button('关闭 ×', 'viewer-close', closeViewer);
    viewerBar.append(viewerCount, viewerOriginal, viewerClose);
    const viewerStage = node('div', 'viewer-stage');
    const viewerPrev = button('‹', 'viewer-prev', () => showViewerImage(viewerIndex - 1));
    const viewerNext = button('›', 'viewer-next', () => showViewerImage(viewerIndex + 1));
    viewerPrev.setAttribute('aria-label', '上一张图片'); viewerNext.setAttribute('aria-label', '下一张图片');
    viewer.append(viewerBar, viewerPrev, viewerStage, viewerNext); shadow.append(viewer);
    viewer.addEventListener('click', event => { if (event.target === viewer || event.target === viewerStage) closeViewer(); });
    viewer.addEventListener('close', () => viewerReturnFocus?.isConnected && viewerReturnFocus.focus({ preventScroll: true }));
    viewer.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); showViewerImage(viewerIndex + (event.key === 'ArrowLeft' ? -1 : 1));
      } else if (event.key === 'Escape') { event.preventDefault(); closeViewer(); }
    });
    function closeViewer() {
      if (!viewer.open) return;
      if (typeof viewer.close === 'function') viewer.close(); else viewer.removeAttribute('open');
      viewerStage.replaceChildren();
      if (viewerReturnFocus?.isConnected) viewerReturnFocus.focus({ preventScroll: true });
    }
    function showViewerImage(index) {
      viewerIndex = Math.max(0, Math.min(index, viewerItems.length - 1));
      const item = viewerItems[viewerIndex]; if (!item) return;
      viewerStage.replaceChildren(makeImage(item.href, item.querySelector('img')?.alt || '', null, false));
      viewerCount.textContent = `${viewerIndex + 1} / ${viewerItems.length}`;
      viewerOriginal.href = item.href;
      viewerPrev.disabled = viewerIndex === 0; viewerNext.disabled = viewerIndex === viewerItems.length - 1;
    }
    function openViewer(attachment) {
      viewerReturnFocus = attachment;
      viewerItems = [...(attachment.closest('.note-gallery') || attachment.closest('.comment') || app).querySelectorAll('.attachment')];
      showViewerImage(viewerItems.indexOf(attachment));
      if (typeof viewer.showModal === 'function') viewer.showModal(); else viewer.setAttribute('open', '');
      viewerClose.focus();
    }
    function makeImage(url, alt, source, interactive = true) {
      const frame = node('span', 'reader-image is-loading'), attachment = link(url, '', 'attachment');
      attachment.setAttribute('aria-label', alt || '查看完整图片');
      const img = node('img'); img.alt = alt; img.decoding = 'async'; img.loading = interactive ? 'lazy' : 'eager'; img.referrerPolicy = 'same-origin';
      const width = Number(source?.getAttribute('width')) || Number(source?.getAttribute('data-nw')) || source?.naturalWidth;
      const height = Number(source?.getAttribute('height')) || Number(source?.getAttribute('data-nh')) || source?.naturalHeight;
      if (width > 0 && height > 0) {
        img.width = width; img.height = height;
        frame.style.setProperty('--image-ratio', `${width} / ${height}`);
        frame.dataset.ratio = `${width} / ${height}`;
      }
      const state = node('span', 'image-state', '图片加载中…'); state.setAttribute('role', 'status');
      const retry = button('重新加载', 'image-retry', () => {
        frame.className = 'reader-image is-loading'; state.textContent = '图片加载中…'; retry.hidden = true;
        img.src = url;
      }); retry.hidden = true;
      const loaded = () => {
        if (!img.naturalWidth) return;
        frame.className = 'reader-image is-loaded'; state.textContent = ''; retry.hidden = true;
        frame.style.setProperty('--image-ratio', `${img.naturalWidth} / ${img.naturalHeight}`);
        frame.dataset.ratio = `${img.naturalWidth} / ${img.naturalHeight}`;
      };
      img.addEventListener('load', loaded);
      img.addEventListener('error', () => {
        frame.className = 'reader-image is-error'; state.textContent = '图片加载失败'; retry.hidden = false;
      });
      attachment.append(img, state); frame.append(attachment, retry);
      attachment.addEventListener('click', event => {
        if (interactive && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
          event.preventDefault(); openViewer(attachment);
        } else if (!interactive && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
          event.preventDefault(); closeViewer();
        }
      });
      img.src = url;
      if (img.complete && img.naturalWidth) loaded();
      return frame;
    }
    function makeGallery(images) {
      const gallery = node('section', 'note-gallery'), track = node('div', 'gallery-track');
      gallery.setAttribute('aria-label', '首楼图集'); track.tabIndex = 0; track.setAttribute('aria-label', '左右滑动浏览图片');
      const count = node('span', 'gallery-count', `1 / ${images.length}`), dots = node('div', 'gallery-dots');
      let current = 0;
      const select = index => {
        current = Math.max(0, Math.min(index, images.length - 1));
        track.scrollTo({ left: current * track.clientWidth, behavior: 'smooth' });
      };
      const prev = button('‹', 'gallery-prev', () => select(current - 1));
      const next = button('›', 'gallery-next', () => select(current + 1));
      prev.setAttribute('aria-label', '上一张'); next.setAttribute('aria-label', '下一张');
      const update = () => {
        if (track.clientWidth) current = Math.round(track.scrollLeft / track.clientWidth);
        count.textContent = `${current + 1} / ${images.length}`;
        [...dots.children].forEach((dot, i) => dot.setAttribute('aria-pressed', String(i === current)));
        prev.disabled = current === 0; next.disabled = current === images.length - 1;
      };
      images.forEach((image, i) => {
        const slide = node('div', 'gallery-slide'); slide.append(image); track.append(slide);
        const img = image.querySelector('img'); img.loading = i === 0 ? 'eager' : 'lazy';
        if (i === 0) img.setAttribute('fetchpriority', 'high');
        const dot = button('', 'gallery-dot', () => select(i)); dot.setAttribute('aria-label', `查看第 ${i + 1} 张`); dots.append(dot);
      });
      track.addEventListener('scroll', update, { passive: true });
      track.addEventListener('keydown', event => {
        if (event.target === track && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
          event.preventDefault(); select(current + (event.key === 'ArrowLeft' ? -1 : 1));
        }
      });
      count.hidden = dots.hidden = prev.hidden = next.hidden = images.length < 2;
      gallery.append(track, count, prev, next, dots); update(); return gallery;
    }

    function sanitized(source, base) {
      const fragment = document.createDocumentFragment();
      const allowed = new Set(['P','DIV','SPAN','BR','B','STRONG','EM','I','U','S','DEL','PRE','CODE','UL','OL','LI','TABLE','THEAD','TBODY','TR','TD','TH','H1','H2','H3','H4','HR','DETAILS','SUMMARY','FONT']);
      const copy = (child, dest) => {
        if (child.nodeType === 3) { dest.append(document.createTextNode(child.textContent)); return; }
        if (child.nodeType !== 1 || ['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','SVG'].includes(child.tagName)) return;
        // NGA 注入的外链提示与装饰括号不是帖子正文；移除后保留实际链接。
        if (child.matches('.urltip, .apd')) return;
        if (child.matches('.reply-reference')) {
          const target = [...child.querySelectorAll('a[href]')].map(a => safeURL(a.getAttribute('href'),base)).find(u => u?.origin === pageURL.origin && u.searchParams.get('tid') === tid && u.searchParams.has('topid'));
          if (target) { dest.append(button(child.textContent.trim(), 'context reply-rel', () => showContext(target))); return; }
        }
        if (child.matches('.quote, blockquote')) {
          const detail = node('details', 'quoted'), title = node('summary');
          const body = node('div', 'quoted-body');
          for (const c of child.childNodes) copy(c, body);
          const raw = body.textContent.replace(/\s+/g, ' ').replace(/\(undefined\)/g, '').trim();
          const excerpt = raw.replace(/^[+R\s]*by\s*/i, '');
          title.textContent = `引用 · ${excerpt.slice(0, 85)}${excerpt.length > 85 ? '…' : ''}`;
          const target = [...child.querySelectorAll('a[href]')].map(a => safeURL(a.getAttribute('href'), base)).find(u => u?.origin === pageURL.origin && u.searchParams.get('tid') === tid && u.searchParams.has('topid'));
          detail.append(title, body);
          if (target) detail.append(button('查看原楼 ↗', 'context', () => showContext(target)));
          dest.append(detail); return;
        }
        if (child.tagName === 'IMG') {
          if (child.getAttribute('style')?.includes('display:none') || child.getAttribute('style')?.includes('display: none')) return;
          const raw = child.getAttribute('data-src') || child.getAttribute('data-original') || child.getAttribute('src');
          if (!raw) return;
          const u = safeURL(raw, base);
          if (!u) return;
          const alt = child.getAttribute('alt') || '';
          if (/smile|emotion/i.test(u.href) || /smile/.test(child.className)) {
            const img = node('img', 'emoji'); img.src = u.href; img.alt = alt; img.loading = 'lazy'; img.referrerPolicy = 'same-origin'; dest.append(img);
          } else dest.append(makeImage(u.href, alt, child));
          return;
        }
        if (child.tagName === 'A') {
          if (child.querySelector('img')) { for (const c of child.childNodes) copy(c, dest); return; }
          const href = child.getAttribute('href');
          const u = href?.trim() ? safeURL(href, base) : null;
          if (!u) { if (!/^[+R]$/.test(child.textContent.trim())) for (const c of child.childNodes) copy(c, dest); return; }
          if (child.classList.contains('pid-reference') && !child.closest('.quote,blockquote,.reply-reference') && u.origin === pageURL.origin && u.searchParams.get('tid') === tid && u.searchParams.has('topid')) {
            dest.append(button('查看原楼 ↗', 'context', () => showContext(u))); return;
          }
          const a = link(u.href, '', 'content-link'); a.rel = 'noopener noreferrer';
          a.title = u.href;
          if (u.origin !== pageURL.origin) {
            a.classList.add('external-link'); a.target = '_blank';
          } else if (child.getAttribute('target') === '_blank') a.target = '_blank';
          for (const c of child.childNodes) copy(c, a);
          if (!a.textContent.trim()) a.textContent = u.href;
          dest.append(a); return;
        }
        const tag = allowed.has(child.tagName) ? (child.tagName === 'FONT' ? 'span' : child.tagName.toLowerCase()) : 'span';
        const el = node(tag); if (child.tagName === 'DETAILS' && child.hasAttribute('open')) el.open = true;
        for (const c of child.childNodes) copy(c, el); dest.append(el);
      };
      for (const child of source.childNodes) copy(child, fragment);
      return fragment;
    }

    function syncCommentActions(card, p, authenticated) {
      const actions = card.querySelector('.comment-actions');
      if (!authenticated) { actions.querySelectorAll('a').forEach(a => a.remove()); return; }
      if (!actions.querySelector('.floor-reply')) actions.append(postLink(p.replyURL, '回复', 'floor-reply'), postLink(p.quoteURL, '引用', 'floor-quote'));
    }

    function makeComment(p, parent) {
      const op = p.floor === 0;
      const signature = [p.author, p.uid, JSON.stringify(p.profile), p.replyURL, p.quoteURL, p.time, p.content.outerHTML, p.original, op ? rtitle.textContent : '', parent?.key || '', parent?.author || ''].join('|');
      const existing = previousCards.get(p.key);
      if (existing?.signature === signature) { cards.set(p.key, existing.card); return existing.card; }
      const card = node('article', `comment${op ? ' op' : ''}`); card.dataset.key = p.key; card.style.setProperty('--bg', color(p.pid || String(p.floor || 0)));
      const head = node('header', 'comment-head'), identity = node('div', 'reader-identity');
      const name = button(p.author, 'reader-author user-trigger', () => userProfiles.show(p, name)); if (op) name.append(node('span', 'op-label', '楼主'));
      identity.append(name, node('div', 'comment-date', p.time));
      const floor = link(p.original, op ? '首楼' : `#${p.floor ?? '?'}`, 'floor');
      floor.title = '在原站查看此楼'; floor.setAttribute('aria-label', `${op ? '首楼' : `第 ${p.floor ?? '?'} 楼`}，在原站查看`);
      const avatar = button(p.author.replace(/^UID:/, '').slice(0, 1) || 'N', 'reader-avatar user-trigger', () => userProfiles.show(p, avatar));
      userProfiles.decorate(avatar, p, true);
      head.append(avatar, identity, floor);
      const body = node('div', 'comment-content'); body.append(sanitized(p.content, p.base));
      const actions = node('div', 'comment-actions');
      actions.append(node('span', 'action-date', p.time));
      card.append(head);
      if (parent) card.append(node('div', 'reply-rel', `回复 #${parent.floor ?? '?'} · ${parent.author}`));
      if (op) {
        const images = [...body.querySelectorAll('.reader-image')].filter(image => !image.closest('.quoted, table, details'));
        const firstFrame = [...body.querySelectorAll('.reader-image')].find(image => !image.closest('.quoted'));
        const firstImage = firstFrame?.querySelector('.attachment');
        if (firstImage) {
          // 记下封面比例，列表可在图片加载前预占位，滚动时卡片高度不跳、点击命中稳定。
          const sent = firstFrame.dataset.ratio || '';
          const [coverW, coverH] = sent.split(' / ').map(Number);
          postCache?.saveCover(tid, firstImage.href, { title: rtitle.textContent, url: pageURL.href, ...(coverW > 0 && coverH > 0 ? { coverW, coverH } : {}) });
          firstFrame.querySelector('img')?.addEventListener('load', () => {
            const img = firstFrame.querySelector('img'), ratio = `${img.naturalWidth} / ${img.naturalHeight}`;
            if (img.naturalWidth > 0 && ratio !== sent) postCache?.saveCover(tid, firstImage.href, { coverW: img.naturalWidth, coverH: img.naturalHeight });
          }, { once: true });
        }
        if (images.length) { card.classList.add('has-gallery'); card.append(makeGallery(images)); }
        const copy = node('div', 'note-copy'); copy.append(node('h1', 'note-title', rtitle.textContent), body);
        card.append(copy, actions);
      } else card.append(body, actions);
      card.readerPost = p; syncCommentActions(card, p, !!currentAccount());
      card.readerSignature = signature; cards.set(p.key, card); return card;
    }

    // Keep unchanged nodes attached: clearing the stream can clamp the browser's
    // scroll position and interrupt mobile scrolling even if it is restored later.
    function reconcileChildren(parent, children) {
      let current = parent.firstChild;
      for (const child of children) {
        if (child !== current) parent.insertBefore(child, current);
        current = child.nextSibling;
      }
      while (current) { const next = current.nextSibling; current.remove(); current = next; }
    }

    function renderReader() {
      const scroll = getReadingScroll();
      const galleryScrolls = [...stream.querySelectorAll('.gallery-track')].map(track => [track, track.scrollLeft]);
      previousCards = new Map([...cards].map(([key, card]) => [key, { card, signature: card.readerSignature }]));
      const sections = new Map([...stream.children].map(section => [Number(section.dataset.page), section]));
      const nextSections = [];
      cards.clear();
      const hasOp = [...records.values()].some(p => p.floor === 0);
      rhead.hidden = hasOp;
      // 同页关系图仅接受一个明确引用，且只能指向较早的非首楼，避免误合并和循环。
      for (const [number, posts] of [...pages].sort((a, b) => a[0] - b[0])) {
        const section = sections.get(number) || node('section', 'reader-page'); section.dataset.page = number;
        const sectionChildren = [], threads = new Map([...section.children].filter(child => child.classList.contains('thread')).map(thread => [thread.dataset.parent, thread]));
        if (!posts.some(p => p.floor === 0)) {
          const heading = [...section.children].find(child => child.classList.contains('page-heading')) || node('div', 'page-heading');
          const label = `第 ${number} 页 · ${posts.length} 个楼层`;
          if (heading.textContent !== label) heading.textContent = label;
          sectionChildren.push(heading);
        }
        const local = new Map(posts.map(p => [p.key, p])), children = new Map(), parents = new Map();
        if (prefs.groupReplies) for (const p of posts) if (p.refs.length === 1) {
          const parent = local.get(`pid:${p.refs[0].pid}`);
          if (parent && parent.floor > 0 && p.floor > parent.floor) {
            parents.set(p.key, parent); if (!children.has(parent.key)) children.set(parent.key, []); children.get(parent.key).push(p);
          }
        }
        const descendants = root => { const out = []; for (const p of children.get(root.key) || []) { out.push(p, ...descendants(p)); } return out; };
        for (const p of posts) {
          if (parents.has(p.key)) continue;
          sectionChildren.push(makeComment(p));
          const replies = descendants(p).sort((a, b) => a.floor - b.floor);
          if (replies.length) {
            const thread = threads.get(p.key) || node('details', 'thread'); thread.dataset.parent = p.key;
            const summary = [...thread.children].find(child => child.tagName === 'SUMMARY') || node('summary');
            const label = `展开 ${replies.length} 条关联回复`;
            if (summary.textContent !== label) summary.textContent = label;
            reconcileChildren(thread, [summary, ...replies.map(reply => makeComment(reply, parents.get(reply.key)))]);
            sectionChildren.push(thread);
          }
        }
        reconcileChildren(section, sectionChildren);
        nextSections.push(section);
      }
      reconcileChildren(stream, nextSections);
      rsub.textContent = `已加载 ${pages.size} 页 · ${records.size} 个楼层 · 引用默认折叠`;
      dockCount.textContent = `评论 ${[...records.values()].filter(p => p.floor !== 0).length}`;
      let last = cursor;
      while (pages.has(last + 1)) last++;
      const atEnd = ended || nextPages.get(last) === false;
      load.hidden = atEnd; endMarker.hidden = !atEnd;
      load.disabled = busy || atEnd; load.textContent = busy ? '正在加载…' : '加载下一页';
      // 浏览器会在节点脱离文档时重置横向滚动，接回后恢复当前图片。
      for (const [track, left] of galleryScrolls) if (track.isConnected) track.scrollLeft = left;
      if (getReadingScroll() !== scroll) setReadingScroll(scroll);
    }

    function focusRecord(key) {
      const card = cards.get(key); if (!card) return false;
      let parent = card.parentElement; while (parent && parent !== app) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
      card.scrollIntoView({ block: 'center', behavior: 'smooth' }); card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1700); return true;
    }

    async function showContext(u) {
      const key = `pid:${u.searchParams.get('topid')}`;
      if (focusRecord(key)) return;
      if (busy) { status.textContent = '正在加载页面，请稍后再查看原楼。'; return; }
      const page = Number(u.searchParams.get('page'));
      if (Number.isInteger(page) && page > 0) {
        await loadPage(page);
        if (focusRecord(key)) return;
      }
      // NGA's older references may omit their page. Search at most the first 500 replies.
      if (!Number.isInteger(page) || page < 1 || page <= 26) {
        for (let number = 1; number <= 26; number++) {
          await loadPage(number);
          if (focusRecord(key)) return;
          if (nextPages.get(number) === false || !pages.has(number)) break;
        }
      }
      status.replaceChildren(node('span', '', '原楼暂未解析到，可在原站查看： '), link(u.href, '打开原楼'));
    }

    async function loadPage(number, advance = false) {
      if (pages.has(number) || busy || !Number.isInteger(number) || number < 1) return;
      busy = true; renderReader(); status.textContent = `正在读取第 ${number} 页…`;
      const u = canonical(number), controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
      const generation = postCache?.generation;
      try {
        const cached = await postCache?.getReplyPage(tid,number), restored = restorePage(cached).filter(p=>!records.has(p.key));
        if (restored.length && generation === postCache?.generation) {
          nextPages.set(number,cached.next); pages.set(number,restored); rebuildRecords(); postCache.visit({tid});
          status.textContent = `第 ${number} 页来自本地缓存`; return;
        }
        const response = await fetch(u.href, { credentials: 'same-origin', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const finalURL = safeURL(response.url || u.href);
        if (!finalURL || finalURL.origin !== pageURL.origin || finalURL.searchParams.get('tid') !== tid) throw new Error('原站返回了其他页面');
        const bytes = new Uint8Array(await response.arrayBuffer()), initial = new TextDecoder('utf-8').decode(bytes);
        const encoding = response.headers.get('content-type')?.match(/charset\s*=\s*([\w-]+)/i)?.[1] || initial.slice(0,4096).match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || 'utf-8';
        const doc = new DOMParser().parseFromString(new TextDecoder(encoding).decode(bytes), 'text/html');
        const all = parsePosts(doc, u.href), fresh = all.filter(p => !records.has(p.key));
        if (!all.length) throw new Error('需要原站跳转、登录，或页面结构不支持');
        if (!fresh.length) { if (advance) ended = true; status.textContent = '原站未返回新的楼层，已停止重复加载。'; return; }
        nextPages.set(number, detectNextPage(doc, number, u.href));
        pages.set(number, fresh); rebuildRecords(); status.textContent = `已加载第 ${number} 页`;
        if (generation === postCache?.generation) cachePage(number,all,nextPages.get(number));
      } catch (error) {
        status.replaceChildren(node('span', '', `${error.name === 'AbortError' ? '加载超时' : error.message}。 `), link(u.href, `直接打开第 ${number} 页`));
      } finally { clearTimeout(timeout); busy = false; renderReader(); }
    }

    updateNative();
    const restoreGeneration = postCache?.generation;
    postCache?.getReplyPage(tid,nativePage).then(cached => {
      if (pages.size || coverDisposed || restoreGeneration !== postCache.generation) return;
      const restored = restorePage(cached); if (!restored.length) return;
      cursor = nativePage; pages.set(nativePage,restored); nextPages.set(nativePage,cached.next); rtitle.textContent = cached.title || rtitle.textContent;
      rebuildRecords(); renderReader(); setMode(!!prefs.enabled); status.textContent = '正在阅读本地缓存';
    });
    const nativeObserver = new MutationObserver(() => { clearTimeout(scanTimer); scanTimer = setTimeout(updateNative, 250); });
    nativeObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    const userSignature = () => {
      const table = readNGAUserData(document, window);
      return JSON.stringify([Object.entries(table.users).map(([uid,u]) => [uid,u.username,u.avatar,u.regdate,u.memberid,u.groupid,u.rvrc,u.money,u.postnum]),table.groups]);
    };
    let lastUsers = userSignature();
    const userRefresh = window.setInterval(() => {
      const signature = userSignature();
      if (signature !== lastUsers) { lastUsers = signature; updateNative(); }
    }, 1200);
    window.addEventListener('pagehide', () => { window.clearInterval(userRefresh); nativeObserver.disconnect(); clearTimeout(scanTimer); clearTimeout(gateTimer); });
  }

  if (/\/read\.php$/.test(pageURL.pathname)) { startReader(); return; }
  scan();
  // 列表由 NGA 后续脚本生成时再扫描，不覆盖登录/错误页。
  const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 220); });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  observeListEnd();
  window.addEventListener('pagehide', () => { observer.disconnect(); cardObserver?.disconnect(); listObserver?.disconnect(); listController?.abort(); clearTimeout(timer); clearTimeout(gateTimer); });
}

const config = {"storageKey":"nga-cards-v1","hosts":["bbs.nga.cn","nga.178.com","ngabbs.com","bbs.ngacn.cc"],"paths":["/thread.php","/read.php"]};
config.accepts = u => config.hosts.includes(u.hostname) && config.paths.includes(u.pathname);
const postCache = createPostCache({ context: window, key: config.storageKey });
config.mountReader = context => { const navigation = createNavigation(config, context); try { runAdapter({ navigation, context, postCache }); } catch (error) { navigation.destroy(); throw error; } return () => { context.dispatchEvent(new context.PageTransitionEvent('pagehide')); navigation.destroy(); }; };
const navigation = createNavigation(config);
const start = () => { if (!config.accepts(new URL(location.href))) { navigation.finish(); return; } try { runAdapter({ navigation, postCache }); } catch (error) { navigation.finish(); console.error('[readscape]', error); } };
if (document.body && document.head) start();
else document.addEventListener('DOMContentLoaded', start, {once:true});
})();
