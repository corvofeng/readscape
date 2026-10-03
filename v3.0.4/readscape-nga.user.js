// ==UserScript==
// @name         阅境 · NGA
// @namespace    nga-cards-local
// @version      3.0.4
// @description  阅境（Readscape）的 NGA 阅读适配器：卡片列表、正文与回复阅读、字体配色设置、手机布局和原生跳转过渡。
// @homepageURL  https://github.com/corvofeng/readscape
// @supportURL   https://github.com/corvofeng/readscape/issues
// @match        https://bbs.nga.cn/thread.php*
// @match        https://bbs.nga.cn/read.php*
// @match        https://bbs.nga.cn/forum.php*
// @match        https://bbs.nga.cn/index.php*
// @match        https://bbs.nga.cn/*
// @match        https://nga.178.com/thread.php*
// @match        https://nga.178.com/read.php*
// @match        https://nga.178.com/forum.php*
// @match        https://nga.178.com/index.php*
// @match        https://nga.178.com/*
// @match        https://ngabbs.com/thread.php*
// @match        https://ngabbs.com/read.php*
// @match        https://ngabbs.com/forum.php*
// @match        https://ngabbs.com/index.php*
// @match        https://ngabbs.com/*
// @match        https://bbs.ngacn.cc/thread.php*
// @match        https://bbs.ngacn.cc/read.php*
// @match        https://bbs.ngacn.cc/forum.php*
// @match        https://bbs.ngacn.cc/index.php*
// @match        https://bbs.ngacn.cc/*
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
  function safeTid(raw) { try { return new URL(raw, location.href).searchParams.get('tid'); } catch { return null; } }
  function isDeletedDoc(doc) {
    if (!doc) return false;
    if (doc.querySelector?.('.postcontent, [id^="postcontent"], #postcontainer0')) return false;
    const title = (doc.title || '').trim();
    const text = doc.body?.textContent || '';
    return /ERROR:\s*62/i.test(text) || /ERROR:\s*62/i.test(title) ||
      title === '帖子被删除' || title === '主题被删除' ||
      /(?:ERROR:\s*62\s*\)?\s*>\s*)?帖子(?:不存在或)?(?:已[被经]|被)?删除/.test(text);
  }
  // 只允许本脚本创建的同源阅读容器运行适配器。
  function disposeBackground() {
    if (!background) return;
    clearInterval(background.poll); clearTimeout(background.timeout);
    document.title = background.title;
    background.cleanup?.();
    background.frame.remove(); background.notice.remove();
    document.documentElement.removeAttribute('data-readscape-reader-open');
    if (background.list) {
      background.list.style.visibility = background.listVisibility;
      background.list.inert = background.listInert;
      background.list.style.overflow = background.listOverflow;
      if (document.documentElement.hasAttribute('data-readscape-document-scroll')) {
        const left = background.documentScroll.left, top = background.documentMode ? background.documentScroll.top : background.listScroll;
        if (window.scrollX !== left || window.scrollY !== top) window.scrollTo({ left, top });
      } else {
        background.list.scrollTop = background.documentMode ? background.documentScroll.top : background.listScroll;
      }
    }
    if (background.shown && background.focus?.isConnected) background.focus.focus({ preventScroll: true });
    background = null;
    document.dispatchEvent(new document.defaultView.Event('readscape-list-resume'));
  }
  function openReader(u, restoring = false) {
    disposeBackground(); finish();
    const frame = document.createElement('iframe');
    frame.dataset.readscapeReader = 'true'; frame.dataset.readscapeListURL = (restoring && history.state?.readscapeListURL) || location.href; frame.title = '帖子与评论';
    frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;height:100dvh;border:0;z-index:2147483002;visibility:hidden;pointer-events:none;background:transparent;overscroll-behavior:none';
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
        if (doc?.body && doc.readyState !== 'loading' && doc.URL !== 'about:blank') {
          const checkDeleted = config.isDeleted || isDeletedDoc;
          if (checkDeleted(doc, u)) {
            const tid = u.searchParams.get('tid') || safeTid(doc.URL);
            disposeBackground();
            document.dispatchEvent(new (document.defaultView?.CustomEvent || CustomEvent)('readscape-post-deleted', {
              detail: { tid, url: u.href, reason: '帖子被删除' }
            }));
            return;
          }
          if (state.mountedDoc !== doc) {
            const childURL = new URL(doc.URL);
            if (childURL.origin !== location.origin || !config.accepts(childURL)) { fail(); return; }
            state.cleanup?.(); state.mountedDoc = doc;
            state.cleanup = config.mountReader?.(frame.contentWindow);
          }
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
          list.style.visibility = 'hidden'; list.inert = true;
          if (!state.documentMode) list.style.overflow = 'hidden';
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

function mountSettings({ context = globalThis.window, shadow, app, prefs, save, change, original, login, cache, openBoards }) {
  const document = context.document;
  const style = document.createElement('style');
  style.textContent = `
    .rt-mask[hidden],.rt-fab[hidden]{display:none!important}
    .rt-fab,.rt-mask{--rt-surface:#fff8fa;--rt-text:#30272d;--rt-muted:#776b73;--rt-accent:#a43d60;--rt-container:#f5dce5;--rt-outline:#d8c4cc}
    [data-rt-theme=dark]{--rt-surface:#202329;--rt-text:#f3e4ed;--rt-muted:#cbb9c4;--rt-accent:#ff8ba0;--rt-container:#35252e;--rt-outline:#34373e;color-scheme:dark}
    [data-rt-theme=paper]{--rt-surface:#faf5eb;--rt-text:#3c332d;--rt-muted:#7b6f61;--rt-container:#eee2cf;--rt-outline:#d3c5b2}
    .rt-fab{position:fixed;right:16px;bottom:calc(24px + env(safe-area-inset-bottom));z-index:2147483010;width:56px;height:56px;display:grid;place-items:center;border:0;border-radius:18px;background:var(--rt-container);color:var(--rt-accent);box-shadow:0 3px 8px #38212e26,0 1px 3px #38212e1a;touch-action:manipulation;transition:box-shadow .18s,transform .18s}
    .rt-fab:active{transform:scale(.94);box-shadow:0 1px 3px #38212e33}.rt-fab svg{width:24px;height:24px;pointer-events:none}
    .rt-mask{position:fixed;inset:0;z-index:2147483015;width:100vw;height:100dvh;max-width:100vw;max-height:100dvh;margin:0;padding:0;border:0;background:rgba(0,0,0,.45);backdrop-filter:blur(4px);pointer-events:auto;display:flex;align-items:center;justify-content:center;color:var(--rt-text);overscroll-behavior:contain;touch-action:pan-y;box-sizing:border-box}
    .rt-mask:not([open]){display:none!important}
    .rt-mask::backdrop{background:transparent}
    .rt-sheet{background:var(--rt-surface);color:var(--rt-text);pointer-events:auto;width:min(500px,calc(100vw - 32px));max-height:86dvh;display:flex;flex-direction:column;overflow:hidden;overscroll-behavior:contain;border-radius:24px;border:1px solid var(--rt-outline);box-shadow:0 14px 50px rgba(0,0,0,.25);font:14px/1.5 system-ui;touch-action:pan-y;position:relative}
    .rt-handle{display:none;width:100%;height:20px;align-items:center;justify-content:center;cursor:grab;flex:none;touch-action:none}
    .rt-handle:before{content:'';width:40px;height:5px;border-radius:3px;background:var(--rt-muted);opacity:.45}
    .rt-header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px 12px;border-bottom:1px solid color-mix(in srgb,var(--rt-outline) 35%,transparent);flex:none;gap:12px}
    .rt-header h2{font-size:17px;font-weight:700;margin:0;display:flex;align-items:center;gap:8px;white-space:nowrap}
    .rt-header .rt-account{font-size:12px;padding:6px 12px;border-radius:16px;background:var(--rt-container);color:var(--rt-accent);min-width:0;max-width:150px;text-align:left;border:0;cursor:pointer}
    .rt-close{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-size:22px;line-height:1;color:var(--rt-muted);background:transparent;border:0;cursor:pointer;transition:background .15s,color .15s}
    .rt-close:hover{background:var(--rt-container);color:var(--rt-accent)}
    .rt-body{flex:1;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:16px 20px calc(16px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:12px;touch-action:pan-y}
    .rt-boards-btn{display:flex;align-items:center;justify-content:space-between;padding:11px 16px;border-radius:16px;background:var(--rt-container);color:var(--rt-accent);font-size:14px;font-weight:700;border:0;cursor:pointer;transition:filter .15s}
    .rt-boards-btn:active{filter:brightness(.92)}
    .rt-sheet label{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:46px;border-bottom:1px solid color-mix(in srgb,var(--rt-outline) 35%,transparent);cursor:pointer}
    .rt-sheet select{max-width:180px;min-height:36px;padding:6px 10px;border:1px solid var(--rt-outline);border-radius:12px;background:transparent;color:var(--rt-text);font:inherit}
    .rt-range{display:flex;align-items:center;gap:10px}.rt-scale{min-width:40px;text-align:right;font-size:13px;color:var(--rt-muted);font-variant-numeric:tabular-nums}.rt-sheet input[type=range]{width:110px;height:36px;accent-color:var(--rt-accent);cursor:pointer}
    .rt-sheet input[type=checkbox]{appearance:none;-webkit-appearance:none;flex:none;width:52px;height:32px;border:2px solid var(--rt-outline);border-radius:20px;background:var(--rt-outline);position:relative;cursor:pointer;transition:background .18s,border-color .18s}.rt-sheet input[type=checkbox]:before{content:'';position:absolute;left:4px;top:4px;width:20px;height:20px;border-radius:50%;background:var(--rt-muted);transition:transform .18s,background .18s}.rt-sheet input[type=checkbox]:checked{background:var(--rt-accent);border-color:var(--rt-accent)}.rt-sheet input[type=checkbox]:checked:before{transform:translateX(20px);background:var(--rt-surface)}
    .rt-sheet button{touch-action:manipulation}
    .rt-actions{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}.rt-actions button{flex:1;min-height:42px;padding:8px 16px;border-radius:20px;background:var(--rt-container);color:var(--rt-accent);font-weight:600;border:0;cursor:pointer;white-space:nowrap;transition:filter .15s}.rt-actions button:active{filter:brightness(.92)}
    .rt-more{background:color-mix(in srgb,var(--rt-surface) 60%,var(--rt-container) 40%);border:1px solid color-mix(in srgb,var(--rt-outline) 40%,transparent);border-radius:18px;padding:4px 16px 12px;margin-top:4px}
    .rt-more>summary{cursor:pointer;color:var(--rt-accent);font-weight:600;padding:10px 0}
    .account-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.account-uid{display:block;font-size:10px;font-weight:400;white-space:nowrap;opacity:.75}.rt-note{font-size:12px;color:var(--rt-muted);margin:10px 0 0}
    .rt-cache{background:color-mix(in srgb,var(--rt-surface) 60%,var(--rt-container) 40%);border:1px solid color-mix(in srgb,var(--rt-outline) 40%,transparent);border-radius:18px;padding:12px 16px;margin-top:4px}
    .rt-cache-usage{font-size:12px;line-height:1.6;color:var(--rt-muted);margin:4px 0 8px;overflow-wrap:anywhere}.rt-cache summary{padding:8px 0;cursor:pointer;color:var(--rt-accent);font-weight:600}.rt-cache input[type=number]{width:84px;min-height:36px;background:var(--rt-container);color:var(--rt-text);border:0;border-radius:8px;padding:6px}
    .rt-clear-cache{padding:7px 14px;border-radius:16px;background:var(--rt-container);color:var(--rt-accent);border:0;font-weight:600;cursor:pointer}
    .rt-reader-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:0 0 8px}.rt-reader-actions[hidden]{display:none}.rt-reader-actions{grid-template-columns:repeat(3,minmax(0,1fr))}.rt-reader-actions button,.rt-reader-actions a{display:flex;align-items:center;justify-content:center;min-height:44px;border-radius:24px;background:var(--rt-container);color:var(--rt-accent);font-weight:600;padding:8px 4px;font-size:13px}.rt-reader-actions .reply-entry{background:var(--rt-accent);color:var(--rt-surface)}
    @keyframes rt-sheet-enter{from{transform:translateY(48px);opacity:0}to{transform:translateY(0);opacity:1}}
    @media(prefers-reduced-motion:reduce){.rt-sheet{animation:none}.rt-fab,.rt-sheet button,.rt-sheet input[type=checkbox],.rt-sheet input[type=checkbox]:before{transition:none}}
    .app{font-family:var(--rt-font,system-ui);max-width:100vw;overflow-x:hidden;text-size-adjust:100%;-webkit-text-size-adjust:100%}.app main,.grid,.bar{min-width:0;width:100%}.grid>.card{min-width:0;max-width:100%}
    .app.rt-settings-open{padding-bottom:calc(30px + var(--rt-panel-height,260px) + env(safe-area-inset-bottom))}.app .comment-content{font-size:calc(15px * var(--rt-scale,1))}.app .comment.op .comment-content{font-size:calc(16px * var(--rt-scale,1))}.app .thread .comment-content{font-size:calc(14px * var(--rt-scale,1))}.app .mobile-caption,.app .image-title{font-size:calc(14px * var(--rt-scale,1))}.app .cover .title{font-size:calc(18px * var(--rt-scale,1))}
    .app.rt-paper{background:#f6f2e9}.app.rt-paper .top,.app.rt-paper .card,.app.rt-paper .comment.op{background:#faf7ef}.app.rt-dark{background:#17191d;color:#e0e0e5;color-scheme:dark}.app.rt-dark .top,.app.rt-dark .card,.app.rt-dark .comment{background:#202329;border-color:#34373e}.app.rt-dark .comment-content,.app.rt-dark .tabs button[aria-selected=true],.app.rt-dark .tabs button[aria-pressed=true]{color:#eee}.app.rt-dark .quoted,.app.rt-dark .search input,.app.rt-dark .load-next{background:#2c3038;color:#bbb}.app.rt-dark .cover:not(.has-image){background:#30343d}.app.rt-dark .cover .title,.app.rt-dark .eyebrow{color:#ddd}.app.rt-dark .tag{background:#444;color:#ddd}
    @media(max-width:600px){
      .rt-mask{align-items:flex-end;padding:0}
      .rt-sheet{width:100vw;max-width:100vw;max-height:86dvh;border-radius:20px 20px 0 0;border:0;box-shadow:0 -8px 36px rgba(0,0,0,.25)}
      .rt-handle{display:flex}
      .rt-header{padding:6px 16px 8px}
      .rt-body{padding:12px 16px calc(14px + env(safe-area-inset-bottom))}
    }
    @media(min-width:601px){.rt-mask{align-items:center;justify-content:center;padding:20px}.rt-sheet{border-radius:24px}.rt-fab{bottom:24px}.app .cover .title{font-size:calc(20px * var(--rt-scale,1))}.app .image-title{font-size:calc(16px * var(--rt-scale,1))}}
  `;
  shadow.append(style);
  const fab = document.createElement('button'); fab.type = 'button'; fab.className = 'rt-fab'; fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>'; fab.setAttribute('aria-haspopup', 'dialog'); fab.setAttribute('aria-controls', 'readscape-settings'); fab.setAttribute('aria-label', '阅读设置'); fab.setAttribute('aria-expanded', 'false');
  const mask = document.createElement('dialog'); mask.id = 'readscape-settings'; mask.setAttribute('aria-label', '阅读设置'); mask.className = 'rt-mask'; mask.hidden = true;
  const sheet = document.createElement('section'); sheet.className = 'rt-sheet'; sheet.tabIndex = -1;
  const header = document.createElement('div'); header.className = 'rt-header';
  const title = document.createElement('h2'); title.innerHTML = '<span>⚙️</span> 阅读设置';
  const close = document.createElement('button'); close.className = 'rt-close'; close.textContent = '×'; close.setAttribute('aria-label', '关闭设置'); header.append(title, close);
  const handle = document.createElement('div'); handle.className = 'rt-handle'; handle.setAttribute('aria-hidden', 'true');
  const body = document.createElement('div'); body.className = 'rt-body';
  sheet.append(handle, header, body);
  let dragStart;
  handle.addEventListener('pointerdown', event => { dragStart = event.clientY; handle.setPointerCapture?.(event.pointerId); });
  handle.addEventListener('pointerup', event => { if (dragStart != null && event.clientY - dragStart > 60) hide(); dragStart = null; });
  handle.addEventListener('pointercancel', () => { dragStart = null; });
  handle.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    dragStart = e.touches[0].clientY;
  }, { passive: true });
  handle.addEventListener('touchmove', e => {
    if (dragStart == null) return;
    const deltaY = e.touches[0].clientY - dragStart;
    if (deltaY > 0) {
      if (e.cancelable) e.preventDefault();
      sheet.style.transform = `translateY(${deltaY}px)`;
    }
  }, { passive: false });
  handle.addEventListener('touchend', () => {
    if (dragStart == null) return;
    const currentY = Number(sheet.style.transform.match(/translateY\(([\d.]+)px\)/)?.[1] || 0);
    if (currentY > 80) {
      sheet.style.transform = 'translateY(100%)';
      setTimeout(() => { hide(); sheet.style.transform = ''; }, 160);
    } else {
      sheet.style.transform = '';
    }
    dragStart = null;
  }, { passive: true });
  const controls = new Map();
  const readerActions = document.createElement('div'); readerActions.className = 'rt-reader-actions'; readerActions.hidden = true; body.append(readerActions);
  if (openBoards) {
    const boardsBtn = document.createElement('button');
    boardsBtn.type = 'button';
    boardsBtn.className = 'rt-boards-btn';
    boardsBtn.innerHTML = '<span>🧭 切换论坛板块</span> ➔';
    boardsBtn.onclick = () => { hide(true, true); openBoards(); };
    body.append(boardsBtn);
  }
  const THEME_COLORS = { light: '#ffffff', paper: '#faf7ef', dark: '#17191d' };
  const originalThemeColor = document.querySelector('meta[name="theme-color"]');
  const originalThemeColorContent = originalThemeColor?.getAttribute('content');
  const themeColorMeta = originalThemeColor || document.createElement('meta');
  themeColorMeta.name = 'theme-color';
  function syncThemeMetadata(active = !fab.hidden) {
    const theme = prefs.theme || 'light';
    const color = THEME_COLORS[theme] || THEME_COLORS.light;
    const docs = [document];
    try {
      if (context.parent && context.parent !== context && context.parent.document) {
        docs.push(context.parent.document);
      }
    } catch {}
    for (const doc of docs) {
      if (active) {
        doc.documentElement.dataset.rtTheme = theme;
        let meta = doc.querySelector('meta[name="theme-color"]');
        if (!meta) {
          meta = doc.createElement('meta');
          meta.name = 'theme-color';
          doc.head?.append(meta);
        }
        meta.setAttribute('content', color);
      } else {
        doc.documentElement.removeAttribute('data-rt-theme');
        const meta = doc.querySelector('meta[name="theme-color"]');
        if (meta) {
          if (doc === document && originalThemeColor) {
            if (originalThemeColorContent == null) meta.removeAttribute('content');
            else meta.setAttribute('content', originalThemeColorContent);
          } else if (doc === document && !originalThemeColor) {
            meta.remove();
          }
        }
      }
    }
  }
  function apply() {
    const scale = Math.min(1.4, Math.max(.85, Number(prefs.fontScale) || 1));
    app.style.setProperty('--rt-scale', scale);
    app.style.setProperty('--rt-font', prefs.font === 'serif' ? '"Songti SC","Noto Serif CJK SC",serif' : prefs.font === 'rounded' ? 'ui-rounded,"Arial Rounded MT Bold","PingFang SC",sans-serif' : '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif');
    const theme = prefs.theme || 'light';
    mask.dataset.rtTheme = fab.dataset.rtTheme = theme;
    app.classList.toggle('rt-paper', theme === 'paper'); app.classList.toggle('rt-dark', theme === 'dark');
    syncThemeMetadata(!fab.hidden);
  }
  function row(label, key, type, options, target = body) {
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
  const moreTitle = document.createElement('summary'); moreTitle.textContent = '更多设置'; more.append(moreTitle); body.append(more);
  row('配色', 'theme', 'select', [['light','明亮'],['paper','暖纸'],['dark','深色']], more);
  row('手机单列', 'single', 'checkbox', undefined, more); row('关联对话', 'groupReplies', 'checkbox', undefined, more); row('平滑跳转过渡', 'smoothNavigation', 'checkbox', undefined, more); row('列表自动刷新（10 秒）', 'autoListRefresh', 'checkbox', undefined, more);
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
  cacheSection.append(cacheUsage, clearCache, cacheOptions, cacheNote); body.append(cacheSection);
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
  function sync() { for (const [key,c] of controls) { if (c.type === 'checkbox') c.checked = ['smoothNavigation','cacheEnabled','autoListRefresh'].includes(key) ? prefs[key] !== false : !!prefs[key]; else c.value = prefs[key] ?? ({fontScale:1,font:'system',theme:'light',cacheMaxPosts:500}[key]); } sheet.querySelector('.rt-scale').textContent = `${Math.round(Number(controls.get('fontScale').value) * 100)}%`; }
  const account = document.createElement('button'); account.className = 'rt-account'; account.textContent = '登录'; account.onclick = () => { hide(true, true); login?.(account); }; if (login) header.insertBefore(account, close);
  let opener = fab, sheetAnimation, animationVersion = 0, closing = false;
  const measurePanel = () => app.style.setProperty('--rt-panel-height', `${Math.ceil(sheet.getBoundingClientRect().height)}px`);
  const panelObserver = typeof context.ResizeObserver === 'function' ? new context.ResizeObserver(measurePanel) : null;
  panelObserver?.observe(sheet);
  context.addEventListener('pagehide', () => { panelObserver?.disconnect(); syncThemeMetadata(false); });
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
      if (!shadow.querySelector('.board-dialog[open]')) {
        document.documentElement.removeAttribute('data-readscape-modal-open');
      }
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
    document.documentElement.setAttribute('data-readscape-modal-open', '');
    if (!mask.open) { if (typeof mask.show === 'function') mask.show(); else mask.setAttribute('open', ''); }
    app.classList.add('rt-settings-open'); measurePanel();
    refreshCache();
    if (canAnimate()) sheetAnimation = sheet.animate(motionFrames(), {duration:260,easing:'cubic-bezier(.2,.8,.2,1)'});
    fab.setAttribute('aria-expanded','true'); close.focus({ preventScroll: true });
  }
  fab.onclick = () => open();
  mask.addEventListener('cancel', event => { event.preventDefault(); hide(); });
  close.onclick = () => hide(); native.onclick = () => { hide(true, true); original(); };
  reset.onclick = () => { Object.assign(prefs,{fontScale:1,font:'system',theme:'light',single:false,groupReplies:false,smoothNavigation:true,autoListRefresh:true,cacheEnabled:true,cacheMaxPosts:500}); save(); sync(); apply(); configureCache(); change(); };
  mask.onclick = e => { if (e.target === mask) hide(); };
  mask.addEventListener('touchmove', event => {
    if (event.target === mask) {
      if (event.cancelable) event.preventDefault();
    }
  }, { passive: false });
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
    visibility(enabled) { fab.hidden = !enabled; if (!enabled) hide(false, true); syncThemeMetadata(enabled); }
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
    html[data-readscape-active][data-rt-theme=paper]{background:#f6f2e9!important}
    html[data-readscape-active][data-rt-theme=dark]{background:#17191d!important;color-scheme:dark}
    html[data-readscape-active]>body{display:none!important}
    html[data-readscape-active]::before,html[data-readscape-active]::after{display:none!important}
    html[data-readscape-active]>#nga-cards-host{all:initial!important;display:block!important;position:fixed!important;inset:0!important;width:100%!important;height:100%!important;height:100dvh!important;z-index:2147483000!important;isolation:isolate!important}
    html[data-readscape-document-scroll]{overflow-x:clip!important;overflow-y:auto!important;height:auto!important;min-height:100%!important;overscroll-behavior-y:auto!important}
    html[data-readscape-document-scroll]>#nga-cards-host{position:relative!important;inset:auto!important;height:auto!important;min-height:100svh!important;contain:none!important}
    html[data-readscape-reader-open],html[data-readscape-modal-open]{overflow:hidden!important;overscroll-behavior:none!important}
    html[data-readscape-modal-open]>body{overflow:hidden!important;touch-action:none!important}
  `;
  document.head.append(surfaceStyle);
  const originalViewport = document.querySelector('meta[name="viewport"]');
  const originalViewportContent = originalViewport?.getAttribute('content');
  const viewport = originalViewport || document.createElement('meta');
  viewport.name = 'viewport';
  let items = [], tab = 'all', query = '', signature = '', timer;
  const isForumRoot = /^\/(?:index\.php|forum\.php)?$/.test(pageURL.pathname) && !pageURL.searchParams.has('fid') && !pageURL.searchParams.has('stid') && !pageURL.searchParams.has('tid');
  let cardObserver, listObserver;
  const listCards = new Map();
  let coverDisposed = false;
  let gateHandled = false, gateTimer;
  let modeToggle = toggle;
  let settingsRefresh = render;
  let readingSettings;
  let accountChanged = () => {};

  const css = "\n    :host{all:initial;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif;color:#27272b;font-size:14px;line-height:1.5}\n    *{box-sizing:border-box}button,input,a{-webkit-tap-highlight-color:transparent}button,input{font:inherit}button,a{touch-action:manipulation}button{cursor:pointer}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #ff7994;outline-offset:3px}\n    a{color:inherit;text-decoration:none}button{border:0;background:none;color:inherit}button:disabled{cursor:default;opacity:.5}[hidden]{display:none!important}\n    .app{position:absolute;inset:0;z-index:2147483000;background:#fafafa;overflow:auto;overscroll-behavior:none;touch-action:pan-x pan-y pinch-zoom;scrollbar-gutter:stable;-webkit-overflow-scrolling:touch;padding-bottom:calc(30px + env(safe-area-inset-bottom));color-scheme:light}\n    .top{position:sticky;top:0;z-index:3;background:rgba(255,255,255,.96);border-bottom:1px solid #ededf0;padding:calc(14px + env(safe-area-inset-top)) 24px 14px;backdrop-filter:blur(16px)}\n    .bar{max-width:1440px;margin:auto;display:flex;align-items:center;gap:18px}.brand{font-size:23px;font-weight:850;letter-spacing:-1px;white-space:nowrap}.brand span{color:#ff2442}\n    .search{flex:1;max-width:460px;position:relative}.search input{width:100%;border:1px solid transparent;border-radius:28px;padding:11px 18px;background:#f4f4f6;color:#26262a;outline:none}.search input:focus{border-color:#ff2442}\n    .spacer{flex:1}.pill{padding:9px 15px;background:#f1f1f4;border-radius:22px;white-space:nowrap;font-size:13px}.pill:hover{background:#e8e8ed}\n    main{max-width:1440px;margin:auto;padding:28px 24px}.intro{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:16px}h1{font-size:25px;letter-spacing:-.7px;margin:0 0 5px}.sub{font-size:12px;color:#8b8b95}.settings{display:none;gap:12px;flex-wrap:wrap;align-items:center;font-size:12px;color:#666671}.settings label{cursor:pointer;display:flex;align-items:center;gap:5px;min-height:36px}.settings input{accent-color:#ff2442}\n    .tabs{display:flex;gap:7px;margin:18px 0 23px}.tabs button{padding:9px 20px;border-radius:22px;color:#777781}.tabs button[aria-selected=true]{background:#ff2442;color:#fff;font-weight:650}\n    .subforum-strip{display:flex!important;align-items:center;gap:8px;overflow-x:auto!important;width:100%;max-width:100%;box-sizing:border-box;padding:6px 0 12px;margin-top:-4px;scrollbar-width:none;-webkit-overflow-scrolling:touch!important;touch-action:pan-x!important;overscroll-behavior-x:contain}\n    .subforum-strip[hidden]{display:none!important}\n    .subforum-strip::-webkit-scrollbar{display:none}\n    .subforum-chip{display:inline-flex;align-items:center;gap:5px;padding:6px 13px;border-radius:16px;background:#f1f1f4;color:#555;font-size:12px;white-space:nowrap;transition:background .15s,color .15s;text-decoration:none;flex:none;touch-action:pan-x;-webkit-tap-highlight-color:transparent}\n    .subforum-chip:hover{background:#e6e6eb;color:#222}\n    .subforum-chip.is-active{background:#ff2442;color:#fff;font-weight:600}\n    .subforum-chip-more{background:#fff;border:1px dashed #dcdce2;color:#a43d60;cursor:pointer}\n    .subforum-chip-more:hover{background:#fff0f3;border-color:#ff8ba0;color:#ff2442}\n    .grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:20px;align-items:start}.card{border-radius:18px;overflow:hidden;background:#fff;border:1px solid #eeeeef;box-shadow:0 2px 6px #00000003;transition:transform .18s,box-shadow .18s;min-width:0}.card:hover{transform:translateY(-3px);box-shadow:0 9px 24px #00000009}\n    .cover{display:flex;flex-direction:column;justify-content:space-between;min-height:190px;padding:20px;background:var(--bg);position:relative;overflow:hidden}.cover:after{content:'';width:110px;height:110px;border-radius:100%;border:20px solid #ffffff60;position:absolute;right:-35px;bottom:-35px;pointer-events:none}.eyebrow{display:flex;gap:5px;align-items:center;font-size:10px;letter-spacing:1px;color:#0008}.tag{font-size:10px;border-radius:6px;padding:2px 6px;background:#ffffff90;letter-spacing:0;color:#59575b}.title{font-size:20px;font-weight:750;line-height:1.5;letter-spacing:-.5px;position:relative;z-index:1;overflow-wrap:anywhere;margin:13px 0 8px;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}.cover.has-image{padding:0;min-height:0}.cover img{width:100%;height:220px;object-fit:cover;display:block;background:#f3f3f3}.image-title{font-size:16px;line-height:1.55;font-weight:700;margin:0 0 9px;overflow-wrap:anywhere}\n    .body{padding:13px 15px 14px}.summary{font-size:12px;color:#7a7a84;line-height:1.8;margin:0 0 11px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}.person{display:flex;align-items:center;gap:7px;min-width:0}.avatar{display:flex;align-items:center;justify-content:center;width:23px;height:23px;border-radius:50%;background:var(--bg);color:#777;font-size:11px;flex:none}.author{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;color:#686872}.save{font-size:20px;line-height:1;padding:6px;flex:none}.save[aria-pressed=true]{color:#ff2442}.meta{display:flex;align-items:center;gap:8px;justify-content:space-between;font-size:10px;color:#9999a2;margin-top:9px;flex-wrap:wrap}.latest{color:#777781;text-decoration:underline;text-underline-offset:3px}.preview{font-size:11px;padding:5px 0;color:#9c7781;margin-top:7px;text-align:left}\n    .pager{display:flex;justify-content:center;flex-wrap:wrap;gap:7px;margin:30px 0 12px}.pager a,.pager span{padding:8px 14px;border-radius:12px;background:#fff;border:1px solid #eee}.pager .current{background:#ff2442;color:white;border-color:#ff2442}.empty{text-align:center;padding:55px 16px;color:#999;font-size:14px}.foot{text-align:center;font-size:11px;color:#999;margin-top:18px}.restore{position:fixed;right:16px;bottom:calc(18px + env(safe-area-inset-bottom));z-index:2147483001;border-radius:24px;background:#ff2442;color:#fff;padding:12px 18px;box-shadow:0 4px 16px #ff244233}\n    @media(min-width:1500px){.grid{grid-template-columns:repeat(6,minmax(0,1fr))}}\n    @media(max-width:1150px){.grid{grid-template-columns:repeat(4,minmax(0,1fr))}.spacer{display:none}}\n    @media(max-width:900px){.grid{grid-template-columns:repeat(3,minmax(0,1fr))}.intro{align-items:flex-start;flex-direction:column}.cover{min-height:170px}}\n    @media(max-width:600px){.top{padding:calc(10px + env(safe-area-inset-top)) 12px 10px}.bar{gap:10px;flex-wrap:wrap}.brand{font-size:21px}.search{order:3;max-width:none;flex-basis:100%}.bar>.pill{margin-left:auto;padding:7px 12px}.search input{padding:9px 15px}main{padding:20px 12px}.intro{gap:5px;margin-bottom:6px}h1{font-size:21px}.settings{gap:12px}.tabs{margin:12px 0 16px}.tabs button{padding:8px 17px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.card{border-radius:13px}.cover{min-height:178px;padding:14px}.title{font-size:17px;line-height:1.55;-webkit-line-clamp:5}.body{padding:10px 11px}.cover img{height:180px}.image-title{font-size:14px}.summary{font-size:11px}.avatar{width:20px;height:20px}.author{font-size:11px}.meta{font-size:10px;gap:4px}.grid.single{grid-template-columns:1fr}.grid.single .cover{min-height:120px}.grid.single .title{-webkit-line-clamp:3}.grid.single .cover img{height:240px}}\n    @media(prefers-reduced-motion:reduce){.card{transition:none}.card:hover{transform:none}}\n    .mobile-tool,.mobile-caption,.settings-native{display:none}\n    @media(max-width:600px){\n      .app{background:#fff}.top{background:#fff;border-bottom:0;padding:calc(8px + env(safe-area-inset-top)) 14px 8px;backdrop-filter:none}.bar{flex-wrap:nowrap!important;gap:6px;align-items:center}.board-bar-btn{display:none!important}.session-status{font-size:12px;color:#a43d60;background:#fff0f3;border-radius:14px;padding:4px 9px;min-height:28px;display:inline-flex;align-items:center;white-space:nowrap;flex:none}.brand{font-size:18px;letter-spacing:0;background:#ff2442;color:white;border-radius:22px;padding:5px 12px;line-height:1.5;flex:none}.brand span{color:white}\n      .mobile-tool{display:inline-flex;align-items:center;justify-content:center;min-width:38px;min-height:38px;border-radius:50%;font-size:22px;color:#555;flex:none}.mobile-tool:first-of-type{margin-left:auto}.bar>.pill{display:none}.bar>.search{display:none}.app.search-open .bar{flex-wrap:wrap!important}.app.search-open .search{display:block;order:3;flex-basis:100%;margin-top:6px}.search input{font-size:16px;background:#f6f6f7}\n      main{padding:10px 12px 24px}.intro{gap:8px;margin:5px 2px 0}h1{font-size:17px;letter-spacing:0;font-weight:650}.sub{font-size:11px;color:#aaa}.settings{display:none!important}.settings-native{display:inline-block;font-size:12px;color:#a66d7d;padding:7px 0}\n      .tabs{gap:26px;overflow-x:auto;scrollbar-width:none;margin:14px 2px 21px}.tabs button{padding:8px 0;border-radius:0;background:none;font-size:16px;color:#888;flex:none;border-bottom:2px solid transparent}.tabs button[aria-selected=true]{background:none;color:#242428;font-weight:700;border-bottom-color:#ff2442}\n      .grid{gap:18px 12px}.card{border:0;background:transparent;border-radius:0;box-shadow:none}.card:hover{transform:none;box-shadow:none}.cover{border-radius:13px}.cover:not(.has-image){aspect-ratio:4/5;min-height:0;justify-content:center;padding:16px}.cover .eyebrow{position:absolute;top:14px;left:14px;font-size:9px}.cover .title{font-size:18px;line-height:1.65;-webkit-line-clamp:4;margin:20px 0 0;letter-spacing:0}.cover img{height:auto;aspect-ratio:4/5;object-fit:cover;border-radius:13px}\n      .body{padding:9px 2px 0}.mobile-caption{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:14px;font-weight:650;line-height:1.55;overflow-wrap:anywhere;margin:0 0 6px}.with-image .mobile-caption{display:none}.image-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:14px;font-weight:650;line-height:1.55;margin:0 0 6px}.body>.summary{display:none}.person{gap:5px}.avatar{height:19px;width:19px;font-size:10px}.author{font-size:11px;color:#898991}.save{font-size:23px;padding:5px 0 5px 8px;min-width:32px;min-height:32px;color:#888}.meta{margin-top:2px;font-size:10px;color:#aaa;gap:3px}.latest{font-size:10px;color:#aaa;text-decoration:none}.preview{font-size:10px;color:#aa8893;margin-top:2px;padding:4px 0}.foot{display:none}.pager{margin-top:28px}\n      .grid.single .cover:not(.has-image){aspect-ratio:auto;min-height:155px}.grid.single .cover img{height:260px;aspect-ratio:auto;object-fit:contain;background:#f7f7f8}.grid.single .mobile-caption{font-size:16px}\n    }\n\n    .grid.masonry{grid-auto-rows:4px;row-gap:0}\n    .grid.masonry>.card{align-self:start;margin-bottom:18px}\n    .cover:not(.has-image){min-height:150px;padding:54px 24px 28px;justify-content:center}\n    .cover .eyebrow{position:absolute;top:18px;left:24px}\n    .cover .title{margin:0}\n    @media(max-width:600px){\n      .cover:not(.has-image){aspect-ratio:auto;min-height:132px;padding:50px 20px 24px}\n      .cover .eyebrow{top:16px;left:20px}\n      .cover .title{margin:0;line-height:1.55;-webkit-line-clamp:6}\n      .grid.single .cover:not(.has-image){min-height:110px}\n    }\n\n    .toolbar-menu{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;margin-left:auto;color:#555}\n    .settings-login,.settings-reading{font-size:12px;color:#a66d7d;min-height:36px;padding:7px 0}\n    .session-status{font-size:12px;color:#8b8b95;white-space:nowrap;min-height:36px;padding:7px 4px}\n    .cover.cached-cover{padding:0;min-height:0;background:#fff;justify-content:flex-start}\n    .cover.cached-cover:before{display:none}\n    .cover.cached-cover:after{display:none}\n    .cover.cached-cover>.cached-cover-image{position:static;inset:auto;z-index:auto;width:100%;height:auto;aspect-ratio:3/4;object-fit:cover;display:block;background:#f3f3f3}\n    .cover.cached-cover>.eyebrow{position:static;top:auto;left:auto;padding:10px 12px 0}\n    .cover.cached-cover .tag{background:#f1f1f4}\n    .cover.cached-cover>.title{position:static;z-index:auto;color:inherit;text-shadow:none;margin:5px 0 0;padding:0 12px 13px;font-size:15px;line-height:1.5;letter-spacing:0;-webkit-line-clamp:2}\n    .intro>.settings{display:none!important}\n    .settings-login{text-align:left;max-width:180px}.settings-login .account-uid{font-size:10px}\n\n    .app.document-scroll{position:relative;inset:auto;min-height:100svh;overflow:visible;overscroll-behavior:auto;scrollbar-gutter:auto}\n    .document-scroll .top{transition:transform .2s ease}\n    .document-scroll.rt-chrome-hidden .top{transform:translateY(-100%)}\n    @media(prefers-reduced-motion:reduce){.document-scroll .top{transition:none}}\n\n    .list-refresh-bar{min-height:42px;display:flex;align-items:center;justify-content:space-between;gap:12px;margin:-8px 0 14px;font-size:12px;color:#8b8b95}\n    .list-refresh-status{display:flex;align-items:center;gap:7px;min-width:0}\n    .list-refresh{flex:none;color:#ff2442;background:#fff0f3;border-radius:20px;padding:7px 12px;transition:background .16s}\n    .list-refresh:hover{background:#ffe1e8}.list-refresh:active{background:#ffd4df}\n    .list-refresh-bar.is-loading .list-refresh-status:before,.list-load:disabled:before{content:'';display:inline-block;width:12px;height:12px;border:2px solid #ffd4df;border-top-color:#ff2442;border-radius:50%;animation:list-spin .7s linear infinite;flex:none}\n    .list-load:disabled{display:inline-flex;align-items:center;gap:7px;opacity:.85}\n    .card-enter{animation:card-appear .24s ease-out both}.cover{transition:filter .12s}.cover:active{filter:brightness(.96)}\n    .save-pop{animation:save-pop .28s ease-out}\n    @keyframes card-appear{from{opacity:0}to{opacity:1}}\n    @keyframes save-pop{0%,100%{transform:scale(1)}45%{transform:scale(1.2)}}\n    @keyframes list-spin{to{transform:rotate(360deg)}}\n    @media(prefers-reduced-motion:reduce){.card-enter,.save-pop,.list-refresh-bar.is-loading .list-refresh-status:before,.list-load:disabled:before{animation:none}.cover,.list-refresh{transition:none}}\n    .list-preparing .empty{min-height:250px;border-radius:18px;color:#999;background:linear-gradient(100deg,#f5f5f7 30%,#fff 45%,#f5f5f7 60%);background-size:250% 100%;animation:list-shimmer 1.4s ease-in-out infinite}\n    @keyframes list-shimmer{from{background-position:100% 0}to{background-position:-100% 0}}\n    @media(prefers-reduced-motion:reduce){.list-preparing .empty{animation:none}}\n    .list-refresh-bar.has-update{position:sticky;top:90px;z-index:2;padding:0 12px;border-radius:12px;background:#fff;box-shadow:0 3px 18px #21132110}\n    @media(max-width:600px){.list-refresh-bar.has-update{top:calc(60px + env(safe-area-inset-top))}.document-scroll.rt-chrome-hidden .list-refresh-bar.has-update{top:8px}}\n    .list-pull{position:fixed;top:calc(64px + env(safe-area-inset-top));left:50%;transform:translate(-50%,-8px);z-index:4;pointer-events:none;padding:10px 18px;border-radius:24px;background:#fff;color:#8b8b95;box-shadow:0 3px 18px #21132118;opacity:0;transition:opacity .16s,transform .16s;white-space:nowrap}\n    .list-pull.is-visible{opacity:1;transform:translate(-50%,0)}.list-pull.is-ready{color:#ff2442;background:#fff0f3}\n    .card-updated{animation:card-update .45s ease-out}\n    @keyframes card-update{from{opacity:.65}to{opacity:1}}\n    .app.rt-dark .list-refresh-bar,.app.rt-dark .list-pull{background:#202329;color:#bbb}.app.rt-dark .list-refresh{background:#3e2732;color:#ffb6c6}\n    @media(prefers-reduced-motion:reduce){.card-updated{animation:none}.list-pull{transition:none}}\n\n    .notice-dialog{position:fixed;z-index:2147483020;inset:0;margin:auto;width:min(420px,calc(100vw - 32px));height:fit-content;max-height:calc(100dvh - 40px);padding:24px 22px 20px;border:1px solid #ededf0;border-radius:20px;background:#fff;color:#27272b;box-shadow:0 12px 40px #00000024;font:14px/1.6 system-ui;display:flex;flex-direction:column;gap:14px;box-sizing:border-box}\n    .notice-dialog:not([open]){display:none}\n    .notice-dialog::backdrop{background:#0000004d;backdrop-filter:blur(3px)}\n    .notice-dialog-title{font-size:17px;font-weight:700;color:#222;display:flex;align-items:center;gap:8px}\n    .notice-dialog-msg{font-size:14px;color:#555;line-height:1.6;overflow-wrap:anywhere}\n    .notice-dialog-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:6px}\n    .notice-dialog-btn{padding:8px 22px;border-radius:20px;background:#ff2442;color:#fff;font-weight:600;font-size:13px;border:0;cursor:pointer;transition:background .15s}\n    .notice-dialog-btn:hover{background:#e01f39}\n    .app.rt-dark .notice-dialog{background:#202329;color:#e2e2e7;border-color:#34373e;box-shadow:0 12px 40px #00000066}\n    .app.rt-dark .notice-dialog-title{color:#eee}\n    .app.rt-dark .notice-dialog-msg{color:#bbb}\n\n    /* 论坛独立主页 Portal 全景布局与分栏 */\n    .board-portal-view{max-width:1280px;margin:8px auto 48px;display:flex;flex-direction:column;gap:18px;width:100%;box-sizing:border-box}\n    .board-portal-banner{padding:22px 26px;background:linear-gradient(135deg,#fff0f3 0%,#fdf6f9 100%);border-radius:20px;border:1px solid #ffd4df;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}\n    .board-portal-title{margin:0 0 5px;font-size:20px;font-weight:750;color:#222}\n    .board-portal-sub{font-size:13px;color:#666;line-height:1.5}\n    .board-portal-actions{display:flex;align-items:center;gap:10px}\n    .board-portal-native-link{font-size:12.5px;color:#a43d60;padding:6px 14px;border-radius:16px;background:#fff;border:1px solid #fed4df;text-decoration:none;transition:background .15s}\n    .board-portal-native-link:hover{background:#fff0f3}\n    \n    .board-portal-search-wrap{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e2e2e7;border-radius:24px;padding:7px 16px;box-shadow:0 2px 8px rgba(0,0,0,0.03);transition:border-color .15s}\n    .board-portal-search-wrap:focus-within{border-color:#ff2442}\n    .board-portal-search-input{flex:1;border:none;outline:none;font-size:14px;background:transparent;color:#222}\n    .board-portal-jump-fid{flex:none;background:#ff2442;color:#fff;border-radius:18px;padding:6px 13px;font-size:12.5px;font-weight:600;white-space:nowrap;cursor:pointer}\n    \n    .board-portal-cat-bar{display:flex;align-items:center;gap:8px;overflow-x:auto;width:100%;max-width:100%;box-sizing:border-box;padding:2px 0 8px;scrollbar-width:none;-webkit-overflow-scrolling:touch;touch-action:pan-x;overscroll-behavior-x:contain}\n    .board-portal-cat-bar::-webkit-scrollbar{display:none}\n    .board-portal-cat-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 15px;border-radius:18px;background:#f2f2f5;color:#555;font-size:13px;font-weight:550;white-space:nowrap;cursor:pointer;border:0;transition:background .15s,color .15s;flex:none}\n    .board-portal-cat-btn:hover{background:#e8e8ed;color:#111}\n    .board-portal-cat-btn.is-active{background:#ff2442;color:#fff;font-weight:650}\n    \n    .board-portal-sections{display:flex;flex-direction:column;gap:20px}\n    .board-portal-section{display:flex;flex-direction:column;gap:12px}\n    .board-portal-section-header{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding-bottom:8px;border-bottom:2px solid #f2f2f5}\n    .board-portal-section-title{display:flex;align-items:center;gap:8px;font-size:16.5px;font-weight:750;color:#222}\n    .board-portal-section-count{font-size:11px;background:#f0f0f4;color:#666;padding:2px 7px;border-radius:10px;font-weight:600}\n    .board-portal-section-desc{font-size:12px;color:#888}\n    \n    .board-portal-cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}\n    .board-portal-card{display:flex;flex-direction:column;justify-content:space-between;padding:13px 15px;border-radius:15px;background:#fff;border:1px solid #ebebf0;box-shadow:0 2px 6px rgba(0,0,0,0.02);transition:transform .15s,box-shadow .15s,border-color .15s;text-decoration:none;min-height:76px;box-sizing:border-box}\n    .board-portal-card:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,0.06);border-color:#ffd4df}\n    .board-portal-card-top{display:flex;align-items:center;justify-content:space-between;gap:8px}\n    .board-portal-card-name{font-size:14px;font-weight:700;color:#222}\n    .board-portal-card:hover .board-portal-card-name{color:#ff2442}\n    .board-portal-card-fid{font-size:10.5px;background:#f2f2f6;color:#777;padding:1px 6px;border-radius:6px;font-weight:600;flex:none}\n    .board-portal-card-desc{font-size:11.5px;color:#777;margin-top:5px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}\n\n    /* Portal 暗色适配 */\n    .app.rt-dark .board-portal-banner{background:linear-gradient(135deg,#2b1f25 0%,#1f2127 100%);border-color:#482833}\n    .app.rt-dark .board-portal-title{color:#f0f0f5}\n    .app.rt-dark .board-portal-sub{color:#aaa}\n    .app.rt-dark .board-portal-native-link{background:#282b32;border-color:#482833;color:#ff8ba0}\n    .app.rt-dark .board-portal-search-wrap{background:#202329;border-color:#34373e}\n    .app.rt-dark .board-portal-search-input{color:#eee}\n    .app.rt-dark .board-portal-cat-btn{background:#23262d;color:#aaa}\n    .app.rt-dark .board-portal-cat-btn:hover{background:#2e323b;color:#fff}\n    .app.rt-dark .board-portal-cat-btn.is-active{background:#ff2442;color:#fff}\n    .app.rt-dark .board-portal-section-header{border-color:#2d3038}\n    .app.rt-dark .board-portal-section-title{color:#eee}\n    .app.rt-dark .board-portal-section-count{background:#292d35;color:#aaa}\n    .app.rt-dark .board-portal-section-desc{color:#888}\n    .app.rt-dark .board-portal-card{background:#202329;border-color:#31353e}\n    .app.rt-dark .board-portal-card:hover{background:#262a32;border-color:#ff8ba0}\n    .app.rt-dark .board-portal-card-name{color:#eee}\n    .app.rt-dark .board-portal-card-fid{background:#2c3038;color:#aaa}\n    .app.rt-dark .board-portal-card-desc{color:#999}\n\n    @media(max-width:600px){\n      .board-portal-view{margin:8px auto 36px;gap:16px}\n      .board-portal-banner{padding:16px 14px;border-radius:16px}\n      .board-portal-title{font-size:18px}\n      .board-portal-cards-grid{grid-template-columns:1fr;gap:9px}\n      .board-portal-card{padding:12px 14px;min-height:68px}\n    }\n\n";
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
    refreshAccount();
    const open = app.classList.toggle('options-open');
    mobileOptions.setAttribute('aria-expanded', String(open));
    readingSettings?.open(mobileOptions);
  }); mobileOptions.setAttribute('aria-label', '展开或收起设置'); mobileOptions.setAttribute('aria-expanded', 'false');
  for (const [control, path] of [[mobileSearch, 'M21 21l-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0'], [mobileOptions, 'M5 6h14M5 12h14M5 18h14']]) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '21'); svg.setAttribute('height', '21'); svg.setAttribute('aria-hidden', 'true');
    shape.setAttribute('d', path); shape.setAttribute('fill', 'none'); shape.setAttribute('stroke', 'currentColor'); shape.setAttribute('stroke-width', '1.7'); shape.setAttribute('stroke-linecap', 'round');
    svg.append(shape); control.append(svg);
  }
  const boardBarBtn = link('/index.php', '板块', 'board-bar-btn');
  boardBarBtn.setAttribute('aria-label', '前往论坛首页选择板块');
  boardBarBtn.addEventListener('click', e => {
    if (e.isTrusted === false && typeof boardsManager?.open === 'function') {
      e.preventDefault();
      boardsManager.open();
    }
  });
  bar.append(brand, search, node('div', 'spacer'), boardBarBtn, mobileSearch, mobileOptions, button('切回原版', 'pill', () => toggle(false)));
  top.append(bar);
  const main = node('main'), intro = node('div', 'intro'), heading = node('div', 'intro-heading');
  const h1 = node('h1', 'board-title', '');
  const h1Text = node('span', 'board-title-text', '论坛发现');
  const switchBadge = link('/index.php', '切换 ↗', 'board-title-switch');
  switchBadge.setAttribute('aria-label', '前往论坛首页切换板块');
  switchBadge.addEventListener('click', e => {
    if (e.isTrusted === false && typeof boardsManager?.open === 'function') {
      e.preventDefault();
      boardsManager.open();
    }
  });
  h1.append(h1Text, switchBadge);
  h1.addEventListener('click', event => {
    if (event.target !== switchBadge) {
      if (isForumRoot) return;
      if (event.isTrusted === false && typeof boardsManager?.open === 'function') boardsManager.open();
      else location.href = '/index.php';
    }
  });
  const subtitle = node('div', 'sub');
  heading.append(h1, subtitle);
  const subforumStrip = node('nav', 'subforum-strip');
  subforumStrip.setAttribute('aria-label', '当前板块子版块导航');
  subforumStrip.hidden = true;
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

  // NGA 论坛全版面与子论坛切换模块（移动端精致分栏与全功能选择器）
function mountBoardsManager({ context = globalThis.window, shadow, app, pageURL, prefs, savePrefs }) {
  const window = context;
  const { document, localStorage, location } = window;

  const FORUM_CATEGORIES = [
    {
      id: 'recommend',
      name: '常用热门',
      icon: '🔥',
      desc: 'NGA 最受关注与高热度的综合讨论区',
      forums: [
        { fid: '-7', name: '晴风村 / 水区', desc: '大杂烩 · 情感 · 树洞 · 生活交流' },
        { fid: '7', name: '艾泽拉斯议事厅', desc: '魔兽世界主讨论区 · 综合交流' },
        { fid: '-447601', name: '二次元国家地理', desc: '动漫 · 漫画 · 综合ACG讨论' },
        { fid: '650', name: '原神', desc: '提瓦特大陆冒险 · 攻略与同人' },
        { fid: '510387', name: '崩坏：星穹铁道', desc: '星穹列车开拓之旅' },
        { fid: '510757', name: '绝区零', desc: '新艾利都冒险之旅' },
        { fid: '-34587507', name: '明日方舟', desc: '罗德岛驻艾泽拉斯大使馆' },
        { fid: '757', name: '蔚蓝档案', desc: '基沃托斯联邦搜查社' },
        { fid: '414', name: 'Steam综合讨论', desc: 'PC游戏 · 促销 · 测评心得' },
        { fid: '415', name: '主机游戏', desc: 'PS / Xbox / Switch / 掌机' },
        { fid: '-152678', name: '英雄联盟', desc: 'Let\'s Gank · 赛事与攻略' },
        { fid: '-1459709', name: '职场人生', desc: '工作 · 职场经验 · 薪资交流' },
        { fid: '-343809', name: '汽车俱乐部', desc: '买车选车 · 用车维修心得' },
        { fid: '334', name: 'PC软硬件', desc: '装机配置 · 硬件数码 · 技术排障' }
      ]
    },
    {
      id: 'mobile',
      name: '手机游戏',
      icon: '📱',
      desc: '二次元手游、抽卡养成与移动端热门作品',
      forums: [
        { fid: '650', name: '原神', desc: '米哈游开放世界冒险' },
        { fid: '510387', name: '崩坏：星穹铁道', desc: '银河回合制冒险RPG' },
        { fid: '510757', name: '绝区零', desc: '都市即时动作冒险' },
        { fid: '-34587507', name: '明日方舟', desc: '鹰角网络策略战术' },
        { fid: '757', name: '蔚蓝档案', desc: '青春学园剧情战术' },
        { fid: '510756', name: '鸣潮', desc: '库洛开放世界动作' },
        { fid: '-40743354', name: '赛马娘 PrettyDerby', desc: 'Cygames养成育成' },
        { fid: '-547859', name: '少女前线', desc: '16LAB研究院' },
        { fid: '-195362', name: '少前2：追放', desc: '美式战棋3D角色扮演' },
        { fid: '-60157311', name: '少前:云图计划', desc: 'Roguelike战术探索' },
        { fid: '564', name: '碧蓝航线', desc: '弹幕海战少女养成' },
        { fid: '549', name: '崩坏3', desc: '点燃国创动作之魂' },
        { fid: '510619', name: '重返未来：1999', desc: '近代复古神秘学RPG' },
        { fid: '638', name: '战双帕弥什', desc: '末世科幻动作' },
        { fid: '538', name: '阴阳师', desc: '平安时代和风回合制' },
        { fid: '-452227', name: '精灵宝可梦', desc: '宝可梦全系列游戏讨论' },
        { fid: '-8180483', name: '影之诗', desc: '日系集换式卡牌对战' },
        { fid: '-15219445', name: '巫师之昆特牌', desc: '来盘昆特牌吧' },
        { fid: '-41232751', name: '四叶草剧场', desc: '魔物娘养成' },
        { fid: '-41374941', name: '悠久之树', desc: '正统日系奇幻RPG' },
        { fid: '-60374520', name: '食物语', desc: '中华美食拟人化' }
      ]
    },
    {
      id: 'wow',
      name: '魔兽世界',
      icon: '⚔️',
      desc: '艾泽拉斯主讨论区、怀旧服、团本大秘与全职业大厅',
      forums: [
        { fid: '7', name: '艾泽拉斯议事厅', desc: '魔兽综合主讨论区' },
        { fid: '641', name: '经典旧世 (怀旧服)', desc: '时光回溯 · 怀旧服专区' },
        { fid: '218', name: '副本讨论区', desc: '团本攻略 · 战术与心得' },
        { fid: '533', name: '大秘境集合石', desc: '史诗钥石地下城交流' },
        { fid: '191', name: '地精商会', desc: '商业技能 · 拍卖行心得' },
        { fid: '200', name: '插件技术综合讨论区', desc: '界面排版 · 插件配置' },
        { fid: '274', name: '原创插件发布区', desc: '自制UI与扩展下载' },
        { fid: '310', name: '精英议会', desc: '前瞻高阶理论研究' },
        { fid: '255', name: '团队管理经验交流', desc: '公会运作与团队建设' },
        { fid: '230', name: '艾泽拉斯风纪委员会', desc: '秩序监督与公示' },
        { fid: '254', name: '镶金玫瑰旅店', desc: '酒馆吹水 · 背景故事' },
        { fid: '124', name: '莫高雷壁画洞穴', desc: '暴雪艺术原创同人' },
        { fid: '319', name: '宏命令讨论区', desc: '宏编写与排错' },
        { fid: '182', name: '法师 - 魔法圣堂', desc: '奥术 / 火焰 / 冰霜' },
        { fid: '181', name: '战士 - 铁血沙场', desc: '武器 / 狂怒 / 防护' },
        { fid: '184', name: '圣骑士 - 圣光广场', desc: '神圣 / 防护 / 惩戒' },
        { fid: '183', name: '牧师 - 信仰神殿', desc: '戒律 / 神圣 / 暗影' },
        { fid: '189', name: '潜行者 - 暗影裂口', desc: '奇袭 / 狂徒 / 敏锐' },
        { fid: '186', name: '德鲁伊 - 翡翠梦境', desc: '平衡 / 野性 / 守护 / 恢复' },
        { fid: '187', name: '猎人 - 猎手大厅', desc: '野兽控制 / 射击 / 生存' },
        { fid: '188', name: '术士 - 恶魔深渊', desc: '痛苦 / 恶魔学识 / 毁灭' },
        { fid: '185', name: '萨满 - 风暴祭坛', desc: '元素 / 增强 / 恢复' },
        { fid: '320', name: '死亡骑士 - 黑锋要塞', desc: '鲜血 / 冰霜 / 邪恶' },
        { fid: '390', name: '武僧 - 五晨寺', desc: '酒仙 / 织雾 / 踏风' },
        { fid: '477', name: '恶魔猎手 - 伊利达雷', desc: '浩劫 / 复仇' },
        { fid: '510340', name: '唤魔师 - 禁忌离岛', desc: '湮灭 / 恩护 / 增辉' }
      ]
    },
    {
      id: 'games',
      name: '游戏综合',
      icon: '🎮',
      desc: '单机、Steam、主机掌机、暴雪综合与独立神作',
      forums: [
        { fid: '414', name: 'Steam综合讨论', desc: 'PC游戏促销 · 测评心得' },
        { fid: '415', name: '主机游戏', desc: 'PS / Xbox / Switch / 掌机' },
        { fid: '-362960', name: '最终幻想14', desc: '艾欧泽亚光之战士' },
        { fid: '560', name: '怪物猎人', desc: '苍蓝星狩猎集会所' },
        { fid: '510740', name: '黑神话：悟空', desc: '西游神话动作冒险' },
        { fid: '686', name: '艾尔登法环 / 魂系列', desc: '交界地褪色者 · 魂系探索' },
        { fid: '615', name: '塞尔达传说', desc: '旷野之息 · 王国之泪' },
        { fid: '510389', name: '模拟经营 / 策略战棋', desc: 'P社四萌 · 文明 · 策略SLG' },
        { fid: '332', name: '战锤40K', desc: '战锤宇宙战役与桌面棋' },
        { fid: '632', name: '暴雪游戏综合', desc: '暴雪娱乐产品综合' },
        { fid: '422', name: '炉石传说', desc: '魔兽英雄传 · 酒馆战棋' },
        { fid: '687', name: '暗黑破坏神4', desc: '庇护之地避难所' },
        { fid: '318', name: '暗黑破坏神3', desc: '奈非天秘境刷刷刷' },
        { fid: '459', name: '守望先锋', desc: '英雄竞技射击' },
        { fid: '273', name: '星际争霸2', desc: '科普卢星区RTS' },
        { fid: '431', name: '风暴英雄', desc: '时空枢纽团战竞技' }
      ]
    },
    {
      id: 'esports',
      name: '竞技网游',
      icon: '🏆',
      desc: '英雄联盟、DOTA2、CS2、无畏契约等电竞赛事与攻略',
      forums: [
        { fid: '-152678', name: '英雄联盟', desc: '赛事资讯 · 英雄攻略 · 云顶' },
        { fid: '321', name: 'DOTA2', desc: '刀塔遗迹保卫战 · 赛事交流' },
        { fid: '731', name: '无畏契约 VALORANT', desc: '拳头战术射击对抗' },
        { fid: '548', name: 'CS:GO / CS2', desc: '反恐精英战术竞技' },
        { fid: '653', name: '云顶之弈', desc: '自走棋阵容与羁绊搭配' },
        { fid: '674', name: '永劫无间', desc: '多人动作战术竞技' },
        { fid: '-6194253', name: '战争雷霆', desc: '海陆空拟真载具射击' },
        { fid: '-7861121', name: '剑网3', desc: '大唐武侠MMO' },
        { fid: '-5080470', name: '流放之路', desc: '硬核刷宝暗黑ARPG' },
        { fid: '-235147', name: '激战2', desc: '泰瑞亚大陆动态世界' }
      ]
    },
    {
      id: 'life',
      name: '综合生活',
      icon: '☕',
      desc: '职场、数码硬件、汽车、美食、影音与情感闲聊',
      forums: [
        { fid: '-7', name: '晴风村 / 水区', desc: '大杂烩 · 情感倾诉 · 闲聊树洞' },
        { fid: '-1459709', name: '职场人生', desc: '职场经验 · 薪酬与求职' },
        { fid: '-343809', name: '汽车俱乐部', desc: '选车购车 · 用车维修心得' },
        { fid: '-2122', name: '机车俱乐部', desc: '两轮骑行 · 路线与摩托推荐' },
        { fid: '-576177', name: '影音讨论区', desc: '电影 · 电视剧 · 音乐鉴赏' },
        { fid: '-608808', name: '恩基爱厨艺美食交流', desc: '家庭烹饪 · 探店与食谱' },
        { fid: '334', name: 'PC软硬件', desc: '装机指南 · 评测与故障排查' },
        { fid: '498', name: '消费电子 / 手机数码', desc: '智能手机 · 平板与数码' },
        { fid: '-353371', name: '萌萌宠物', desc: '喵星人 · 汪星人日常' },
        { fid: '-187628', name: 'Home, sweet home', desc: '买房避坑 · 家装家居' },
        { fid: '-447601', name: '二次元国家地理', desc: '动漫追番 · 轻小说杂谈' },
        { fid: '510425', name: '模玩专区', desc: '手办 · 高达 · 兵人与雕像' },
        { fid: '510376', name: '跑团 / TRPG', desc: '桌游 · DND · 跑团战报' },
        { fid: '-7678526', name: '艾泽拉斯麻将科学院', desc: '日麻 · 雀魂与国标' },
        { fid: '-81981', name: '生命之杯', desc: '足球赛事 · 俱乐部与球星' }
      ]
    }
  ];

  const FORUM_MAP = new Map();
  for (const category of FORUM_CATEGORIES) {
    for (const item of category.forums) {
      if (!FORUM_MAP.has(String(item.fid))) FORUM_MAP.set(String(item.fid), item);
    }
  }

  const RECENT_KEY = 'nga-cards-v1-recent-boards';
  function readRecentBoards() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
  }
  function writeRecentBoards(list) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12))); } catch {}
  }
  function recordRecentBoard(item) {
    if (!item || (!item.fid && !item.stid) || !item.name) return;
    const list = readRecentBoards();
    const fid = item.fid ? String(item.fid) : null;
    const stid = item.stid ? String(item.stid) : null;
    const filtered = list.filter(b => (fid ? b.fid !== fid : true) && (stid ? b.stid !== stid : true));
    filtered.unshift({
      fid, stid, name: item.name,
      desc: item.desc || (fid ? `FID ${fid}` : `STID ${stid}`),
      url: item.url || (stid ? `/thread.php?stid=${stid}` : `/thread.php?fid=${fid}`),
      time: Date.now()
    });
    writeRecentBoards(filtered);
  }
  function clearRecentBoards() {
    try { localStorage.removeItem(RECENT_KEY); } catch {}
  }

  function extractCurrentSubforums(doc = document, win = window, url = pageURL) {
    const list = [], seen = new Set();
    const curFid = url.searchParams.get('fid');
    const curStid = url.searchParams.get('stid');

    const allData = win.__ALL_FORUM_DATA;
    if (allData && typeof allData === 'object') {
      for (const [key, val] of Object.entries(allData)) {
        if (!Array.isArray(val) || val.length < 2) continue;
        const rawId = String(val[0] || key);
        const isStid = rawId.startsWith('t') || rawId.startsWith('s') || ((Number(val[4]) & 16) !== 0);
        const cleanId = rawId.replace(/^[ts]/, '');
        if ((isStid && cleanId === curStid) || (!isStid && cleanId === curFid)) continue;
        const keyStr = isStid ? `stid:${cleanId}` : `fid:${cleanId}`;
        if (seen.has(keyStr)) continue;
        seen.add(keyStr);
        const name = String(val[1] || '').trim();
        const desc = String(val[2] || '').trim();
        if (!name || name.length < 2) continue;
        const targetUrl = isStid ? `/thread.php?stid=${cleanId}` : `/thread.php?fid=${cleanId}`;
        list.push({ fid: isStid ? null : cleanId, stid: isStid ? cleanId : null, name, desc, url: targetUrl });
      }
    }

    const subLinks = doc.querySelectorAll('#sub_forums_c a[href*="thread.php"], #more_sub_forums_c a[href*="thread.php"]');
    for (const a of subLinks) {
      const raw = a.getAttribute('href');
      if (!raw) continue;
      let u; try { u = new URL(raw, win.location.href); } catch { continue; }
      const fid = u.searchParams.get('fid'), stid = u.searchParams.get('stid');
      if (!fid && !stid) continue;
      if ((fid && fid === curFid) || (stid && stid === curStid)) continue;
      const keyStr = stid ? `stid:${stid}` : `fid:${fid}`;
      if (seen.has(keyStr)) continue;
      seen.add(keyStr);
      const name = a.textContent.trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (!name || name.length < 2) continue;
      list.push({ fid, stid, name, desc: '', url: u.pathname + u.search });
    }

    return list;
  }

  function detectBoardInfo(doc = document, win = window, url = pageURL) {
    const fid = url.searchParams.get('fid');
    const stid = url.searchParams.get('stid');

    if (fid && FORUM_MAP.has(fid)) {
      return { fid, stid, name: FORUM_MAP.get(fid).name };
    }

    if (win.__ALL_FORUM_DATA && typeof win.__ALL_FORUM_DATA === 'object') {
      if (fid && win.__ALL_FORUM_DATA[fid]?.[1]) {
        return { fid, stid, name: String(win.__ALL_FORUM_DATA[fid][1]).trim() };
      }
      if (stid && win.__ALL_FORUM_DATA[`t${stid}`]?.[1]) {
        return { fid, stid, name: String(win.__ALL_FORUM_DATA[`t${stid}`][1]).trim() };
      }
    }

    const navLink = doc.querySelector('#m_nav h1 a, .nav h1 a, #m_nav .nav_link, .nav_link');
    if (navLink && navLink.textContent.trim().length > 1) {
      return { fid, stid, name: navLink.textContent.trim() };
    }

    const boardA = [...doc.querySelectorAll('#m_nav a[href*="thread.php"], a[href*="thread.php"]')].find(a => {
      try {
        const u = new URL(a.getAttribute('href'), win.location.href);
        return (stid && u.searchParams.get('stid') === stid) || (fid && u.searchParams.get('fid') === fid);
      } catch { return false; }
    });
    if (boardA && boardA.textContent.trim().length > 1) {
      return { fid, stid, name: boardA.textContent.trim() };
    }

    const cleanTitle = (doc.title || '').replace(/\s*[-_].*NGA.*$/i, '').trim();
    if (cleanTitle && cleanTitle !== '访客不能直接访问' && cleanTitle !== '未登录' && cleanTitle !== 'NGA玩家社区') {
      return { fid, stid, name: cleanTitle };
    }

    return {
      fid, stid,
      name: fid ? `板块 (FID ${fid})` : (stid ? `主题集 (${stid})` : '论坛发现')
    };
  }

  // 构建板块切换器 UI 样式与弹窗（分栏布局）
  const style = node('style', '', `
    .board-dialog{position:fixed;z-index:2147483015;inset:0;width:100vw;height:100dvh;max-width:100vw;max-height:100dvh;margin:0;padding:0;border:0;background:rgba(0,0,0,.45);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;box-sizing:border-box;touch-action:pan-y;overscroll-behavior:contain}
    .board-dialog:not([open]){display:none!important}
    .board-dialog::backdrop{background:transparent}

    .board-dialog-sheet{width:min(780px,calc(100vw - 24px));height:min(86dvh,760px);max-height:86dvh;background:#fff;color:#27272b;border:1px solid #e8e8ed;border-radius:24px;box-shadow:0 14px 50px rgba(0,0,0,.25);font:14px/1.5 system-ui;display:flex;flex-direction:column;overscroll-behavior:contain;overflow:hidden;touch-action:pan-y;position:relative}

    .board-handle{display:none;width:100%;height:18px;align-items:center;justify-content:center;cursor:grab;flex:none;touch-action:none}
    .board-handle::before{content:'';width:38px;height:4.5px;border-radius:3px;background:#d0d0d6}

    .board-dialog-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px 12px;border-bottom:1px solid #f0f0f3;flex:none;touch-action:none}
    .board-dialog-title{display:flex;align-items:center;gap:8px;font-size:17px;font-weight:700;color:#222}
    .board-dialog-title .board-icon{font-size:19px}
    .board-dialog-close{font-size:24px;line-height:1;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:#888;transition:background .15s}
    .board-dialog-close:hover{background:#f0f0f4;color:#222}
    
    .board-search-box{padding:10px 20px;background:#fafafc;border-bottom:1px solid #f0f0f3;display:flex;align-items:center;gap:10px;flex:none}
    .board-search-icon{color:#999;flex:none}
    .board-search-input{flex:1;border:1px solid #e2e2e7;border-radius:22px;padding:9px 16px;background:#fff;color:#222;font-size:14px;outline:none;transition:border-color .15s}
    .board-search-input:focus{border-color:#ff2442}
    .board-jump-fid{flex:none;background:#ff2442;color:#fff;border-radius:20px;padding:7px 14px;font-size:13px;font-weight:600;white-space:nowrap;transition:filter .15s}
    .board-jump-fid:hover{filter:brightness(1.08)}

    /* 左右分栏核心容器 */
    .board-split-layout{flex:1;display:flex;min-height:0;height:100%;overflow:hidden}
    
    /* 左侧栏目导航 */
    .board-sidebar{width:150px;background:#f7f7f9;border-right:1px solid #f0f0f3;overflow-y:auto;display:flex;flex-direction:column;padding:8px 0;flex:none;touch-action:pan-y;overscroll-behavior-y:contain;-webkit-overflow-scrolling:touch}
    .board-cat-item{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;font-size:13px;font-weight:550;color:#555;cursor:pointer;border-left:3px solid transparent;transition:background .15s,color .15s,border-color .15s;text-align:left;position:relative;touch-action:pan-y}
    .board-cat-item:hover{background:#efeff2;color:#111}
    .board-cat-item.is-active{background:#fff;color:#ff2442;font-weight:700;border-left-color:#ff2442}
    .board-cat-item-main{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .board-cat-item-badge{font-size:10px;background:#ffe6eb;color:#ff2442;padding:1px 6px;border-radius:10px;font-weight:600}
    
    /* 右侧板块列表内容区 */
    .board-main-pane{flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:14px;min-width:0;touch-action:pan-y;overscroll-behavior-y:contain;-webkit-overflow-scrolling:touch}
    .board-pane-header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-bottom:10px;border-bottom:1px solid #f4f4f6}
    .board-pane-title{font-size:15px;font-weight:700;color:#333}
    .board-pane-desc{font-size:12px;color:#888;margin-top:2px}
    .board-pane-extra{flex:none}
    
    /* 搜索全屏结果视图 */
    .board-search-results{flex:1;overflow-y:auto;padding:16px 20px;touch-action:pan-y;overscroll-behavior-y:contain;-webkit-overflow-scrolling:touch}

    /* 板块卡片网格 */
    .board-cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
    .board-card{display:flex;flex-direction:column;justify-content:space-between;padding:12px 14px;border-radius:14px;background:#f9f9fb;border:1px solid #eeeeef;transition:transform .14s,box-shadow .14s,border-color .14s;text-decoration:none;min-height:74px;touch-action:pan-y}
    .board-card:hover{transform:translateY(-2px);background:#fff;box-shadow:0 4px 14px #0000000a;border-color:#ffd4df}
    .board-card.is-active{background:#fff8fa;border-color:#ff8ba0}
    .board-card-main{display:flex;align-items:center;justify-content:space-between;gap:6px}
    .board-card-name{font-size:14px;font-weight:650;color:#222}
    .board-card.is-active .board-card-name{color:#ff2442}
    .board-card-active-tag{font-size:10px;background:#ff2442;color:#fff;padding:2px 6px;border-radius:8px;font-weight:600;flex:none}
    .board-card-desc{font-size:11px;color:#888;margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.4}
    .board-card-meta{display:flex;align-items:center;justify-content:space-between;margin-top:8px;font-size:11px;color:#aaa}
    .board-card-fid{background:#eaeaef;color:#666;padding:1px 6px;border-radius:6px;font-size:10px}

    /* Chip 样式（兼容旧版与快捷标签） */
    .board-chips-grid{display:flex;flex-wrap:wrap;gap:8px}
    .board-chip{display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border-radius:18px;background:#f3f3f6;color:#333;font-size:13px;transition:background .15s,color .15s;text-decoration:none;touch-action:manipulation}
    .board-chip:hover{background:#e7e7ec;color:#111}
    .board-chip.is-active{background:#fff0f3;color:#ff2442;font-weight:650;border:1px solid #ffd4df}
    .board-chip-desc{font-size:11px;color:#888;font-weight:normal}
    .board-clear-recent{font-size:12px;color:#999;cursor:pointer;padding:2px 8px;border-radius:12px}
    .board-clear-recent:hover{background:#f0f0f4;color:#666}

    .board-empty-search{text-align:center;padding:36px 12px;color:#888;font-size:14px}
    .board-empty-search strong{color:#ff2442}

    .board-dialog-footer{padding:10px 20px;border-top:1px solid #f0f0f3;display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#888;background:#fafafc;flex:none}
    .board-native-link{color:#a43d60;text-decoration:none}
    .board-native-link:hover{text-decoration:underline}

    /* 列表顶部子版块横向标签栏 */
    .subforum-strip{display:flex;align-items:center;gap:8px;overflow-x:auto;width:100%;max-width:100%;box-sizing:border-box;padding:6px 0 12px;margin-top:-4px;scrollbar-width:none;-webkit-overflow-scrolling:touch;touch-action:pan-x;overscroll-behavior-x:contain}
    .subforum-strip[hidden]{display:none!important}
    .subforum-strip::-webkit-scrollbar{display:none}
    .subforum-chip{display:inline-flex;align-items:center;gap:5px;padding:6px 13px;border-radius:16px;background:#f1f1f4;color:#555;font-size:12px;white-space:nowrap;transition:background .15s,color .15s;text-decoration:none;flex:none;touch-action:pan-x;-webkit-tap-highlight-color:transparent}
    .subforum-chip:hover{background:#e6e6eb;color:#222}
    .subforum-chip.is-active{background:#ff2442;color:#fff;font-weight:600}
    .subforum-chip-more{background:#fff;border:1px dashed #dcdce2;color:#a43d60;cursor:pointer}
    .subforum-chip-more:hover{background:#fff0f3;border-color:#ff8ba0;color:#ff2442}

    /* 顶部标题旁快捷切换板块徽章 */
    .board-title{display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap;cursor:pointer}
    .board-title-switch{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;padding:4px 10px;border-radius:14px;background:#f3f3f6;color:#666;border:1px solid #e4e4e9;transition:background .15s,border-color .15s,color .15s}
    .board-title:hover .board-title-switch,.board-title-switch:hover{background:#fff0f3;color:#ff2442;border-color:#ffd4df}
    .board-bar-btn{display:inline-flex;align-items:center;gap:5px;padding:7px 13px;border-radius:20px;background:#fff0f3;color:#ff2442;font-size:13px;font-weight:600;white-space:nowrap;transition:background .15s}
    .board-bar-btn:hover{background:#ffe2e8}

    /* 暗色主题适配 */
    .app.rt-dark .board-dialog-sheet, .app.rt-dark ~ .board-dialog .board-dialog-sheet, .board-dialog[data-rt-theme=dark] .board-dialog-sheet{background:#202329;color:#e2e2e7;border-color:#34373e;box-shadow:0 12px 48px #00000066}
    .app.rt-dark .board-dialog-header, .app.rt-dark ~ .board-dialog .board-dialog-header, .board-dialog[data-rt-theme=dark] .board-dialog-header,
    .app.rt-dark .board-dialog-footer, .app.rt-dark ~ .board-dialog .board-dialog-footer, .board-dialog[data-rt-theme=dark] .board-dialog-footer,
    .app.rt-dark .board-search-box, .app.rt-dark ~ .board-dialog .board-search-box, .board-dialog[data-rt-theme=dark] .board-search-box{background:#1a1c20;border-color:#2c3038}
    .app.rt-dark .board-sidebar, .app.rt-dark ~ .board-dialog .board-sidebar, .board-dialog[data-rt-theme=dark] .board-sidebar{background:#181a1f;border-color:#2c3038}
    .app.rt-dark .board-cat-item, .app.rt-dark ~ .board-dialog .board-cat-item, .board-dialog[data-rt-theme=dark] .board-cat-item{color:#aaa}
    .app.rt-dark .board-cat-item:hover, .app.rt-dark ~ .board-dialog .board-cat-item:hover, .board-dialog[data-rt-theme=dark] .board-cat-item:hover{background:#22252c;color:#eee}
    .app.rt-dark .board-cat-item.is-active, .app.rt-dark ~ .board-dialog .board-cat-item.is-active, .board-dialog[data-rt-theme=dark] .board-cat-item.is-active{background:#202329;color:#ff8ba0;border-left-color:#ff2442}
    .app.rt-dark .board-pane-header, .app.rt-dark ~ .board-dialog .board-pane-header, .board-dialog[data-rt-theme=dark] .board-pane-header{border-color:#2c3038}
    .app.rt-dark .board-pane-title, .app.rt-dark ~ .board-dialog .board-pane-title, .board-dialog[data-rt-theme=dark] .board-pane-title{color:#eee}
    .app.rt-dark .board-dialog-title, .app.rt-dark ~ .board-dialog .board-dialog-title, .board-dialog[data-rt-theme=dark] .board-dialog-title{color:#eee}
    .app.rt-dark .board-search-input, .app.rt-dark ~ .board-dialog .board-search-input, .board-dialog[data-rt-theme=dark] .board-search-input{background:#282c34;color:#eee;border-color:#3b404b}
    .app.rt-dark .board-chip, .app.rt-dark ~ .board-dialog .board-chip, .board-dialog[data-rt-theme=dark] .board-chip{background:#2c3038;color:#bbb}
    .app.rt-dark .board-chip:hover, .app.rt-dark ~ .board-dialog .board-chip:hover, .board-dialog[data-rt-theme=dark] .board-chip:hover{background:#383d47;color:#fff}
    .app.rt-dark .board-chip.is-active, .app.rt-dark ~ .board-dialog .board-chip.is-active, .board-dialog[data-rt-theme=dark] .board-chip.is-active{background:#422530;color:#ff8ba0;border-color:#653342}
    .app.rt-dark .board-card, .app.rt-dark ~ .board-dialog .board-card, .board-dialog[data-rt-theme=dark] .board-card{background:#252930;border-color:#323742}
    .app.rt-dark .board-card:hover, .app.rt-dark ~ .board-dialog .board-card:hover, .board-dialog[data-rt-theme=dark] .board-card:hover{background:#2b3039;border-color:#ff8ba0}
    .app.rt-dark .board-card.is-active, .app.rt-dark ~ .board-dialog .board-card.is-active, .board-dialog[data-rt-theme=dark] .board-card.is-active{background:#35252e;border-color:#ff8ba0}
    .app.rt-dark .board-card-name, .app.rt-dark ~ .board-dialog .board-card-name, .board-dialog[data-rt-theme=dark] .board-card-name{color:#eee}
    .app.rt-dark .board-card-fid, .app.rt-dark ~ .board-dialog .board-card-fid, .board-dialog[data-rt-theme=dark] .board-card-fid{background:#1b1d22;color:#aaa}
    .app.rt-dark .subforum-chip, .app.rt-dark ~ .board-dialog .subforum-chip, .board-dialog[data-rt-theme=dark] .subforum-chip{background:#262a32;color:#aaa}
    .app.rt-dark .subforum-chip:hover, .app.rt-dark ~ .board-dialog .subforum-chip:hover, .board-dialog[data-rt-theme=dark] .subforum-chip:hover{background:#323742;color:#fff}
    .app.rt-dark .subforum-chip.is-active, .app.rt-dark ~ .board-dialog .subforum-chip.is-active, .board-dialog[data-rt-theme=dark] .subforum-chip.is-active{background:#ff2442;color:#fff}
    .app.rt-dark .board-title-switch, .app.rt-dark ~ .board-dialog .board-title-switch, .board-dialog[data-rt-theme=dark] .board-title-switch{background:#262a32;border-color:#383747;color:#aaa}
    .app.rt-dark .board-bar-btn, .app.rt-dark ~ .board-dialog .board-bar-btn, .board-dialog[data-rt-theme=dark] .board-bar-btn{background:#3e242c;color:#ff8ba0}

    /* 手机端分栏与抽屉优化 */
    @media(max-width:600px){
      .board-dialog{align-items:flex-end}
      .board-dialog-sheet{width:100vw;max-width:100vw;height:86dvh;max-height:86dvh;border-radius:20px 20px 0 0;border:0;box-shadow:0 -8px 36px rgba(0,0,0,.25)}
      .board-handle{display:flex;height:20px}
      .board-handle::before{width:40px;height:5px}
      .board-sidebar{width:108px;padding:4px 0}
      .board-cat-item{padding:12px 8px;font-size:12.5px}
      .board-cat-item-main{gap:4px}
      .board-main-pane{padding:12px 14px}
      .board-cards-grid{grid-template-columns:1fr;gap:8px}
      .board-card{padding:11px 12px;min-height:60px}
      .board-dialog-header{padding:6px 16px 8px}
      .board-dialog-title{font-size:16px}
      .board-search-box{padding:8px 14px}
      .board-dialog-footer{padding:8px 14px calc(8px + env(safe-area-inset-bottom))}
    }

    /* 论坛独立主页 Portal 全景布局与分栏 */
    .board-portal-view{max-width:1280px;margin:8px auto 48px;display:flex;flex-direction:column;gap:18px;width:100%;box-sizing:border-box}
    .board-portal-banner{padding:22px 26px;background:linear-gradient(135deg,#fff0f3 0%,#fdf6f9 100%);border-radius:20px;border:1px solid #ffd4df;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
    .board-portal-title{margin:0 0 5px;font-size:20px;font-weight:750;color:#222}
    .board-portal-sub{font-size:13px;color:#666;line-height:1.5}
    .board-portal-actions{display:flex;align-items:center;gap:10px}
    .board-portal-native-link{font-size:12.5px;color:#a43d60;padding:6px 14px;border-radius:16px;background:#fff;border:1px solid #fed4df;text-decoration:none;transition:background .15s}
    .board-portal-native-link:hover{background:#fff0f3}
    
    .board-portal-search-wrap{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e2e2e7;border-radius:24px;padding:7px 16px;box-shadow:0 2px 8px rgba(0,0,0,0.03);transition:border-color .15s}
    .board-portal-search-wrap:focus-within{border-color:#ff2442}
    .board-portal-search-input{flex:1;border:none;outline:none;font-size:14px;background:transparent;color:#222}
    .board-portal-jump-fid{flex:none;background:#ff2442;color:#fff;border-radius:18px;padding:6px 13px;font-size:12.5px;font-weight:600;white-space:nowrap;cursor:pointer}
    
    .board-portal-cat-bar{display:flex;align-items:center;gap:8px;overflow-x:auto;width:100%;max-width:100%;box-sizing:border-box;padding:2px 0 8px;scrollbar-width:none;-webkit-overflow-scrolling:touch;touch-action:pan-x;overscroll-behavior-x:contain}
    .board-portal-cat-bar::-webkit-scrollbar{display:none}
    .board-portal-cat-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 15px;border-radius:18px;background:#f2f2f5;color:#555;font-size:13px;font-weight:550;white-space:nowrap;cursor:pointer;border:0;transition:background .15s,color .15s;flex:none}
    .board-portal-cat-btn:hover{background:#e8e8ed;color:#111}
    .board-portal-cat-btn.is-active{background:#ff2442;color:#fff;font-weight:650}
    
    .board-portal-sections{display:flex;flex-direction:column;gap:20px}
    .board-portal-section{display:flex;flex-direction:column;gap:12px}
    .board-portal-section-header{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding-bottom:8px;border-bottom:2px solid #f2f2f5}
    .board-portal-section-title{display:flex;align-items:center;gap:8px;font-size:16.5px;font-weight:750;color:#222}
    .board-portal-section-count{font-size:11px;background:#f0f0f4;color:#666;padding:2px 7px;border-radius:10px;font-weight:600}
    .board-portal-section-desc{font-size:12px;color:#888}
    
    .board-portal-cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
    .board-portal-card{display:flex;flex-direction:column;justify-content:space-between;padding:13px 15px;border-radius:15px;background:#fff;border:1px solid #ebebf0;box-shadow:0 2px 6px rgba(0,0,0,0.02);transition:transform .15s,box-shadow .15s,border-color .15s;text-decoration:none;min-height:76px;box-sizing:border-box}
    .board-portal-card:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,0.06);border-color:#ffd4df}
    .board-portal-card-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .board-portal-card-name{font-size:14px;font-weight:700;color:#222}
    .board-portal-card:hover .board-portal-card-name{color:#ff2442}
    .board-portal-card-fid{font-size:10.5px;background:#f2f2f6;color:#777;padding:1px 6px;border-radius:6px;font-weight:600;flex:none}
    .board-portal-card-desc{font-size:11.5px;color:#777;margin-top:5px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}

    /* Portal 暗色适配 */
    .app.rt-dark .board-portal-banner{background:linear-gradient(135deg,#2b1f25 0%,#1f2127 100%);border-color:#482833}
    .app.rt-dark .board-portal-title{color:#f0f0f5}
    .app.rt-dark .board-portal-sub{color:#aaa}
    .app.rt-dark .board-portal-native-link{background:#282b32;border-color:#482833;color:#ff8ba0}
    .app.rt-dark .board-portal-search-wrap{background:#202329;border-color:#34373e}
    .app.rt-dark .board-portal-search-input{color:#eee}
    .app.rt-dark .board-portal-cat-btn{background:#23262d;color:#aaa}
    .app.rt-dark .board-portal-cat-btn:hover{background:#2e323b;color:#fff}
    .app.rt-dark .board-portal-cat-btn.is-active{background:#ff2442;color:#fff}
    .app.rt-dark .board-portal-section-header{border-color:#2d3038}
    .app.rt-dark .board-portal-section-title{color:#eee}
    .app.rt-dark .board-portal-section-count{background:#292d35;color:#aaa}
    .app.rt-dark .board-portal-section-desc{color:#888}
    .app.rt-dark .board-portal-card{background:#202329;border-color:#31353e}
    .app.rt-dark .board-portal-card:hover{background:#262a32;border-color:#ff8ba0}
    .app.rt-dark .board-portal-card-name{color:#eee}
    .app.rt-dark .board-portal-card-fid{background:#2c3038;color:#aaa}
    .app.rt-dark .board-portal-card-desc{color:#999}

    /* 打开弹窗时阻断底层滚动 */
    :host-context(.boards-open), .app.boards-open{overflow:hidden!important}
  `);

  (shadow || app).append(style);

  const dialog = node('dialog', 'board-dialog');
  dialog.setAttribute('aria-label', '选择论坛板块');

  // Sheet 容器承载抽屉卡片主体，dialog 自身作为全屏遮罩与手势隔离层
  const sheet = node('div', 'board-dialog-sheet');

  // 手机端顶部滑动指示条
  const handle = node('div', 'board-handle');

  const header = node('div', 'board-dialog-header');
  const titleWrap = node('div', 'board-dialog-title');
  titleWrap.append(node('span', 'board-icon', '🧭'), node('span', '', '切换论坛板块'));
  const closeBtn = button('×', 'board-dialog-close', () => close());
  closeBtn.setAttribute('aria-label', '关闭板块切换');
  header.append(titleWrap, closeBtn);

  const searchBox = node('div', 'board-search-box');
  const searchSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  searchSvg.setAttribute('class', 'board-search-icon');
  searchSvg.setAttribute('viewBox', '0 0 24 24'); searchSvg.setAttribute('width', '18'); searchSvg.setAttribute('height', '18');
  searchSvg.innerHTML = '<path d="M21 21l-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  const searchInput = node('input', 'board-search-input');
  searchInput.type = 'text';
  searchInput.setAttribute('inputmode', 'search');
  searchInput.placeholder = '搜索板块名称，或输入 FID 直达…';
  searchInput.setAttribute('aria-label', '搜索板块名称或输入板块ID');
  const jumpFidBtn = button('进入 FID ➔', 'board-jump-fid', () => jumpToFid(searchInput.value.trim()));
  jumpFidBtn.hidden = true;
  searchBox.append(searchSvg, searchInput, jumpFidBtn);

  // 左右分栏容器
  const splitLayout = node('div', 'board-split-layout');
  const sidebar = node('nav', 'board-sidebar');
  sidebar.setAttribute('aria-label', '版面分类导航');
  sidebar.setAttribute('role', 'tablist');

  const mainPane = node('main', 'board-main-pane');
  const paneHeader = node('div', 'board-pane-header');
  const paneTitleWrap = node('div');
  const paneTitle = node('div', 'board-pane-title', '常用热门');
  const paneDesc = node('div', 'board-pane-desc', '');
  paneTitleWrap.append(paneTitle, paneDesc);
  const paneExtra = node('div', 'board-pane-extra');
  paneHeader.append(paneTitleWrap, paneExtra);

  function handleClearRecent() {
    clearRecentBoards();
    testRecentSection.hidden = true;
    testRecentList.replaceChildren();
    activeCategoryId = 'recommend';
    renderSidebar();
    renderRightPane();
  }

  // 兼容测试容器：隐藏的 subforums 与 recent 容器保留 class 供 querySelector 使用
  const testSubSection = node('div', 'board-section board-section-subforums'); testSubSection.hidden = true;
  const testSubList = node('div', 'board-chips-grid board-subforums-list'); testSubSection.append(testSubList);
  const testRecentSection = node('div', 'board-section board-section-recent'); testRecentSection.hidden = true;
  const testRecentList = node('div', 'board-chips-grid board-recent-list');
  const testClearRecent = button('清空', 'board-clear-recent', () => handleClearRecent());
  testRecentSection.append(testRecentList, testClearRecent);
  // 保留隐藏的 category tabs 容器兼容旧测试 querySelector
  const testCatTabs = node('div', 'board-category-tabs'); testCatTabs.hidden = true;

  const cardsGrid = node('div', 'board-cards-grid');
  mainPane.append(paneHeader, cardsGrid, testSubSection, testRecentSection, testCatTabs);

  splitLayout.append(sidebar, mainPane);

  // 搜索全屏视图
  const searchResults = node('div', 'board-search-results');
  searchResults.hidden = true;
  const searchCardsGrid = node('div', 'board-cards-grid board-search-grid');
  searchResults.append(searchCardsGrid);

  const footer = node('div', 'board-dialog-footer');
  footer.append(
    node('span', '', '💡 支持输入任意版面 FID 直达'),
    link('/forum.php', '原版全部板块 ↗', 'board-native-link')
  );
  footer.querySelector('a').dataset.readscapeNative = 'true';

  sheet.append(handle, header, searchBox, splitLayout, searchResults, footer);
  dialog.append(sheet);
  (shadow || app).append(dialog);

  // 状态变量
  let activeCategoryId = 'recommend';
  let searchQuery = '';
  let cachedSubforums = [];

  function jumpToFid(fid) {
    const clean = fid.replace(/^[^\d-]+/, '').trim();
    if (/^-?\d+$/.test(clean)) {
      recordRecentBoard({ fid: clean, name: FORUM_MAP.get(clean)?.name || `板块 FID ${clean}` });
      close();
      window.location.assign(`/thread.php?fid=${clean}`);
    }
  }

  function renderSidebar() {
    sidebar.replaceChildren();
    const recent = readRecentBoards();

    // 组织栏目列表
    const categories = [];

    // 1. 常用热门
    categories.push({ id: 'recommend', name: '常用热门', icon: '🔥' });

    // 2. 当前子版块（如有）
    if (cachedSubforums.length) {
      categories.push({ id: 'subforums', name: '当前子版', icon: '📂', badge: String(cachedSubforums.length) });
    }

    // 3. 最近访问（如有）
    if (recent.length) {
      categories.push({ id: 'recent', name: '最近访问', icon: '🕒', badge: String(recent.length) });
    }

    // 4. 其余分类
    for (const cat of FORUM_CATEGORIES) {
      if (cat.id !== 'recommend') {
        categories.push({ id: cat.id, name: cat.name, icon: cat.icon });
      }
    }

    // 确保激活分类存在
    if (!categories.some(c => c.id === activeCategoryId)) {
      activeCategoryId = 'recommend';
    }

    for (const cat of categories) {
      const item = node('button', `board-cat-item${cat.id === activeCategoryId ? ' is-active' : ''}`);
      item.type = 'button';
      item.setAttribute('role', 'tab');
      item.setAttribute('aria-selected', String(cat.id === activeCategoryId));

      const mainSpan = node('span', 'board-cat-item-main');
      mainSpan.append(node('span', '', cat.icon), document.createTextNode(` ${cat.name}`));
      item.append(mainSpan);

      if (cat.badge) {
        item.append(node('span', 'board-cat-item-badge', cat.badge));
      }

      item.addEventListener('click', () => {
        activeCategoryId = cat.id;
        renderSidebar();
        renderRightPane();
      });

      sidebar.append(item);
    }
  }

  function renderRightPane() {
    cardsGrid.replaceChildren();
    paneExtra.replaceChildren();
    const curFid = pageURL.searchParams.get('fid');
    const curStid = pageURL.searchParams.get('stid');

    if (activeCategoryId === 'subforums') {
      paneTitle.textContent = '当前板块子版块';
      paneDesc.textContent = `共 ${cachedSubforums.length} 个子版块或关联合集`;
      testSubSection.hidden = false;
      testSubList.replaceChildren();

      for (const sub of cachedSubforums) {
        const isCur = (sub.fid && sub.fid === curFid) || (sub.stid && sub.stid === curStid);
        const card = link(sub.url, '', `board-card${isCur ? ' is-active' : ''}`);

        const mainRow = node('div', 'board-card-main');
        mainRow.append(node('span', 'board-card-name', sub.name));
        if (isCur) mainRow.append(node('span', 'board-card-active-tag', '当前'));
        card.append(mainRow);

        if (sub.desc) card.append(node('div', 'board-card-desc', sub.desc));

        const meta = node('div', 'board-card-meta');
        if (sub.fid) meta.append(node('span', 'board-card-fid', `FID ${sub.fid}`));
        else if (sub.stid) meta.append(node('span', 'board-card-fid', `STID ${sub.stid}`));
        card.append(meta);

        card.addEventListener('click', () => { recordRecentBoard(sub); close(); });
        cardsGrid.append(card);

        // 同时放入 testSubList 兼容测试查找
        const chip = link(sub.url, sub.name, `board-chip${isCur ? ' is-active' : ''}`);
        chip.addEventListener('click', () => { recordRecentBoard(sub); close(); });
        testSubList.append(chip);
      }
      return;
    }

    if (activeCategoryId === 'recent') {
      const recent = readRecentBoards();
      paneTitle.textContent = '最近访问板块';
      paneDesc.textContent = `保留最近浏览过的 ${recent.length} 个板块`;

      const clearBtn = button('清空历史', 'board-clear-recent', () => {
        handleClearRecent();
      });
      paneExtra.append(clearBtn);

      testRecentSection.hidden = false;
      testRecentList.replaceChildren();

      for (const item of recent) {
        const isCur = (item.fid && item.fid === curFid) || (item.stid && item.stid === curStid);
        const card = link(item.url, '', `board-card${isCur ? ' is-active' : ''}`);

        const mainRow = node('div', 'board-card-main');
        mainRow.append(node('span', 'board-card-name', item.name));
        if (isCur) mainRow.append(node('span', 'board-card-active-tag', '当前'));
        card.append(mainRow);

        if (item.desc) card.append(node('div', 'board-card-desc', item.desc));

        const meta = node('div', 'board-card-meta');
        if (item.fid) meta.append(node('span', 'board-card-fid', `FID ${item.fid}`));
        else if (item.stid) meta.append(node('span', 'board-card-fid', `STID ${item.stid}`));
        card.append(meta);

        card.addEventListener('click', () => { recordRecentBoard(item); close(); });
        cardsGrid.append(card);

        // 同时放入 testRecentList 兼容测试查找
        const chip = link(item.url, item.name, `board-chip${isCur ? ' is-active' : ''}`);
        chip.addEventListener('click', () => { recordRecentBoard(item); close(); });
        testRecentList.append(chip);
      }
      return;
    }

    // 标准分类板块
    const cat = FORUM_CATEGORIES.find(c => c.id === activeCategoryId) || FORUM_CATEGORIES[0];
    paneTitle.textContent = `${cat.icon} ${cat.name}`;
    paneDesc.textContent = cat.desc || `共 ${cat.forums.length} 个推荐板块`;

    for (const forum of cat.forums) {
      const isCur = String(forum.fid) === curFid;
      const url = forum.url || `/thread.php?fid=${forum.fid}`;
      const card = link(url, '', `board-card${isCur ? ' is-active' : ''}`);

      const mainRow = node('div', 'board-card-main');
      mainRow.append(node('span', 'board-card-name', forum.name));
      if (isCur) mainRow.append(node('span', 'board-card-active-tag', '当前'));
      card.append(mainRow);

      if (forum.desc) card.append(node('div', 'board-card-desc', forum.desc));

      const meta = node('div', 'board-card-meta');
      if (forum.fid) meta.append(node('span', 'board-card-fid', `FID ${forum.fid}`));
      else if (forum.stid) meta.append(node('span', 'board-card-fid', `STID ${forum.stid}`));
      card.append(meta);

      card.addEventListener('click', () => {
        recordRecentBoard({ fid: forum.fid, stid: forum.stid, name: forum.name, url });
        close();
      });

      cardsGrid.append(card);
    }
  }

  function renderSearchResults() {
    searchCardsGrid.replaceChildren();
    const q = searchQuery.toLowerCase().trim();
    const curFid = pageURL.searchParams.get('fid');

    const seenFids = new Set();
    const matched = [];

    // 全局匹配各分类
    for (const cat of FORUM_CATEGORIES) {
      for (const forum of cat.forums) {
        const fidStr = String(forum.fid);
        if (seenFids.has(fidStr)) continue;
        if (forum.name.toLowerCase().includes(q) || (forum.desc && forum.desc.toLowerCase().includes(q)) || fidStr.includes(q)) {
          seenFids.add(fidStr);
          matched.push(forum);
        }
      }
    }

    // 匹配子版块
    for (const sub of cachedSubforums) {
      const idStr = sub.fid || sub.stid || '';
      if (sub.name.toLowerCase().includes(q) || idStr.includes(q)) {
        matched.push(sub);
      }
    }

    if (!matched.length) {
      const empty = node('div', 'board-empty-search');
      empty.innerHTML = `未找到包含 "<strong>${q}</strong>" 的板块。若知道版面 ID，可直接点击右上角进入。`;
      searchCardsGrid.append(empty);
      return;
    }

    for (const forum of matched) {
      const isCur = String(forum.fid) === curFid;
      const url = forum.url || `/thread.php?fid=${forum.fid}`;
      const card = link(url, '', `board-card${isCur ? ' is-active' : ''}`);

      const mainRow = node('div', 'board-card-main');
      mainRow.append(node('span', 'board-card-name', forum.name));
      if (isCur) mainRow.append(node('span', 'board-card-active-tag', '当前'));
      card.append(mainRow);

      if (forum.desc) card.append(node('div', 'board-card-desc', forum.desc));

      const meta = node('div', 'board-card-meta');
      if (forum.fid) meta.append(node('span', 'board-card-fid', `FID ${forum.fid}`));
      else if (forum.stid) meta.append(node('span', 'board-card-fid', `STID ${forum.stid}`));
      card.append(meta);

      card.addEventListener('click', () => {
        recordRecentBoard({ fid: forum.fid, stid: forum.stid, name: forum.name, url });
        close();
      });

      searchCardsGrid.append(card);
    }
  }

  // 搜索处理
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    if (/^-?\d+$/.test(searchQuery)) {
      jumpFidBtn.hidden = false;
      jumpFidBtn.textContent = `进入 FID ${searchQuery} ➔`;
    } else {
      jumpFidBtn.hidden = true;
    }

    if (searchQuery) {
      cardsGrid.replaceChildren();
      splitLayout.hidden = true;
      searchResults.hidden = false;
      testCatTabs.hidden = true;
      renderSearchResults();
    } else {
      searchCardsGrid.replaceChildren();
      splitLayout.hidden = false;
      searchResults.hidden = true;
      testCatTabs.hidden = false;
      renderRightPane();
    }
  });

  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      const val = searchInput.value.trim();
      if (/^-?\d+$/.test(val)) jumpToFid(val);
      else {
        const firstCard = (searchQuery ? searchCardsGrid : cardsGrid).querySelector('.board-card');
        if (firstCard) firstCard.click();
      }
    }
  });

  // 手机端顶部把手与标题支持下滑关闭手势
  let startY = 0;
  let currentTranslateY = 0;
  let isDraggingSheet = false;

  for (const trigger of [handle, header]) {
    trigger.addEventListener('touchstart', e => {
      if (e.touches.length !== 1 || e.target.closest('.board-dialog-close, button, input')) return;
      startY = e.touches[0].clientY;
      isDraggingSheet = true;
      sheet.style.transition = 'none';
    }, { passive: true });

    trigger.addEventListener('touchmove', e => {
      if (!isDraggingSheet) return;
      const deltaY = e.touches[0].clientY - startY;
      if (deltaY > 0) {
        if (e.cancelable) e.preventDefault();
        currentTranslateY = deltaY;
        sheet.style.transform = `translateY(${deltaY}px)`;
      }
    }, { passive: false });

    trigger.addEventListener('touchend', () => {
      if (!isDraggingSheet) return;
      isDraggingSheet = false;
      sheet.style.transition = 'transform .2s cubic-bezier(.16, 1, .3, 1)';
      if (currentTranslateY > 80) {
        sheet.style.transform = 'translateY(100%)';
        setTimeout(() => {
          close();
          sheet.style.transform = '';
        }, 160);
      } else {
        sheet.style.transform = '';
      }
      currentTranslateY = 0;
    }, { passive: true });
  }

  dialog.addEventListener('click', event => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('cancel', () => { close(); });
  dialog.addEventListener('touchmove', event => {
    if (event.target === dialog) {
      if (event.cancelable) event.preventDefault();
    }
  }, { passive: false });
  dialog.addEventListener('wheel', event => {
    if (event.target === dialog) event.preventDefault();
  }, { passive: false });

  let savedDocOverflow = '';
  let savedBodyOverflow = '';
  let savedBodyTouchAction = '';

  function open(initialQuery = '') {
    dialog.dataset.rtTheme = prefs?.theme || 'light';
    app.classList.add('boards-open');
    if (document.documentElement) {
      document.documentElement.setAttribute('data-readscape-modal-open', '');
      savedDocOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      document.documentElement.classList.add('rt-boards-locked');
    }
    if (document.body) {
      savedBodyOverflow = document.body.style.overflow;
      savedBodyTouchAction = document.body.style.touchAction;
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
      document.body.classList.add('rt-boards-locked');
    }

    cachedSubforums = extractCurrentSubforums(document, window, pageURL);
    // 如果当前板块有子版块，默认定位到子版
    if (cachedSubforums.length && activeCategoryId !== 'recent') {
      activeCategoryId = 'subforums';
    } else if (activeCategoryId === 'subforums' && !cachedSubforums.length) {
      activeCategoryId = 'recommend';
    }

    // 填充测试兼容容器
    const recent = readRecentBoards();
    testRecentSection.hidden = !recent.length;
    testRecentList.replaceChildren();
    for (const item of recent) {
      const chip = link(item.url, item.name, 'board-chip');
      chip.addEventListener('click', () => { recordRecentBoard(item); close(); });
      testRecentList.append(chip);
    }
    testSubSection.hidden = !cachedSubforums.length;
    testSubList.replaceChildren();
    for (const sub of cachedSubforums) {
      const chip = link(sub.url, sub.name, 'board-chip');
      chip.addEventListener('click', () => { recordRecentBoard(sub); close(); });
      testSubList.append(chip);
    }

    searchInput.value = initialQuery;
    searchQuery = initialQuery;
    jumpFidBtn.hidden = !/^-?\d+$/.test(initialQuery);

    if (searchQuery) {
      cardsGrid.replaceChildren();
      splitLayout.hidden = true;
      searchResults.hidden = false;
      testCatTabs.hidden = true;
      renderSearchResults();
    } else {
      searchCardsGrid.replaceChildren();
      splitLayout.hidden = false;
      searchResults.hidden = true;
      testCatTabs.hidden = false;
      renderSidebar();
      renderRightPane();
    }

    if (typeof dialog.showModal === 'function') {
      try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); dialog.open = true; }
    } else {
      dialog.setAttribute('open', '');
      dialog.open = true;
    }
    searchInput.focus?.();
  }

  function close() {
    // 恢复底层页面滚动
    app.classList.remove('boards-open');
    if (document.documentElement) {
      document.documentElement.removeAttribute('data-readscape-modal-open');
      document.documentElement.style.overflow = savedDocOverflow;
      document.documentElement.classList.remove('rt-boards-locked');
    }
    if (document.body) {
      document.body.style.overflow = savedBodyOverflow;
      document.body.style.touchAction = savedBodyTouchAction;
      document.body.classList.remove('rt-boards-locked');
    }

    if (typeof dialog.close === 'function') {
      try { dialog.close(); } catch { dialog.removeAttribute('open'); dialog.open = false; }
    } else {
      dialog.removeAttribute('open');
      dialog.open = false;
    }
  }

  // 渲染列表页面顶部的子版块横条 (Subforum Strip)
  function renderSubforumStrip(container) {
    if (!container) return;
    const subforums = extractCurrentSubforums(document, window, pageURL);
    cachedSubforums = subforums;
    if (!subforums.length) {
      container.hidden = true;
      return;
    }
    container.hidden = false;
    container.replaceChildren();

    const curFid = pageURL.searchParams.get('fid');
    const curStid = pageURL.searchParams.get('stid');
    const isMainBoard = !curStid;

    // 全部讨论 chip
    const allChip = link(pageURL.pathname + (curFid ? `?fid=${curFid}` : ''), '全部', `subforum-chip${isMainBoard ? ' is-active' : ''}`);
    container.append(allChip);

    for (const sub of subforums) {
      const isCur = (sub.fid && sub.fid === curFid) || (sub.stid && sub.stid === curStid);
      const chip = link(sub.url, sub.name, `subforum-chip${isCur ? ' is-active' : ''}`);
      chip.addEventListener('click', () => { recordRecentBoard(sub); });
      container.append(chip);
    }

    const moreChip = link('/index.php', '更多板块 ↗', 'subforum-chip subforum-chip-more');
    moreChip.target = '_blank';
    moreChip.rel = 'noopener noreferrer';
    moreChip.setAttribute('title', '前往论坛主页查看全部板块（在新页面打开）');
    container.append(moreChip);
  }

  // 从原站首页（forum.php / index.php）DOM 及 window 全局变量中提取板块与分类
  function extractNativeHomepageBoards(doc = document, win = window) {
    const nativeForums = [];
    const seen = new Set();

    const allData = win.__ALL_FORUM_DATA || win.__F;
    if (allData && typeof allData === 'object') {
      for (const [key, val] of Object.entries(allData)) {
        if (!Array.isArray(val) || val.length < 2) continue;
        const rawId = String(val[0] || key);
        const isStid = rawId.startsWith('t') || rawId.startsWith('s') || ((Number(val[4]) & 16) !== 0);
        const cleanId = rawId.replace(/^[ts]/, '');
        const keyStr = isStid ? `stid:${cleanId}` : `fid:${cleanId}`;
        if (seen.has(keyStr)) continue;
        seen.add(keyStr);
        const name = String(val[1] || '').trim();
        const desc = String(val[2] || '').trim();
        if (!name || name.length < 2) continue;
        const url = isStid ? `/thread.php?stid=${cleanId}` : `/thread.php?fid=${cleanId}`;
        nativeForums.push({ fid: isStid ? null : cleanId, stid: isStid ? cleanId : null, name, desc, url });
      }
    }

    const links = doc.querySelectorAll('a[href*="thread.php?fid="], a[href*="thread.php?stid="], #custombg a[href*="thread.php"]');
    for (const a of links) {
      const raw = a.getAttribute('href');
      if (!raw) continue;
      let u;
      try { u = new URL(raw, win.location.href); } catch { continue; }
      const fid = u.searchParams.get('fid');
      const stid = u.searchParams.get('stid');
      if (!fid && !stid) continue;
      const keyStr = stid ? `stid:${stid}` : `fid:${fid}`;
      if (seen.has(keyStr)) continue;
      seen.add(keyStr);
      const name = a.textContent.trim().replace(/^\s*\[.*?\]\s*/, '');
      if (!name || name.length < 2) continue;
      const parentTd = a.closest('td, li, .forum_group, div');
      let desc = '';
      if (parentTd) {
        const descEl = parentTd.querySelector('.desc, .small, .explain, span');
        if (descEl && descEl !== a) desc = descEl.textContent.trim();
      }
      const url = stid ? `/thread.php?stid=${stid}` : `/thread.php?fid=${fid}`;
      nativeForums.push({ fid, stid, name, desc, url });
    }

    return nativeForums;
  }

  // 渲染在 bbs.nga.cn/ 或 forum.php 根首页时的板块导航独立分栏全景视图
  function renderPortalView(mainContainer, emptyContainer) {
    if (emptyContainer) emptyContainer.hidden = true;
    let portal = mainContainer.querySelector('.board-portal-view');
    if (!portal) {
      portal = node('div', 'board-portal-view');
      mainContainer.insertBefore(portal, emptyContainer);
    }
    portal.replaceChildren();

    // 重新解析原版主页中的板块，并与预设分类深度融合
    const nativeForums = extractNativeHomepageBoards(document, window);
    const categories = FORUM_CATEGORIES.map(cat => ({
      id: cat.id,
      name: cat.name,
      icon: cat.icon,
      desc: cat.desc,
      forums: [...cat.forums]
    }));

    const knownFids = new Set();
    for (const cat of categories) {
      for (const f of cat.forums) {
        if (f.fid) knownFids.add(String(f.fid));
      }
    }

    const extraForums = [];
    for (const nf of nativeForums) {
      const idKey = nf.fid ? String(nf.fid) : (nf.stid ? `stid:${nf.stid}` : null);
      if (!idKey || knownFids.has(idKey)) continue;
      knownFids.add(idKey);
      extraForums.push(nf);
    }

    if (extraForums.length > 0) {
      categories.push({
        id: 'native-extra',
        name: '原版其他板块',
        icon: '📂',
        desc: `从当前原版首页解析到的其他 ${extraForums.length} 个版面与合集`,
        forums: extraForums
      });
    }

    // 1. 欢迎全景横幅
    const banner = node('div', 'board-portal-banner');
    const bannerLeft = node('div');
    const bTitle = node('h2', 'board-portal-title', '欢迎使用 阅境 · NGA 版块导航');
    const bSub = node('div', 'board-portal-sub', 'NGA 拥有成百上千个精彩子版块。选择您感兴趣的板块开始沉浸式阅读：');
    bannerLeft.append(bTitle, bSub);

    const bannerActions = node('div', 'board-portal-actions');
    const nativeLink = link('/forum.php', '原版首页 ↗', 'board-portal-native-link');
    nativeLink.dataset.readscapeNative = 'true';
    bannerActions.append(nativeLink);
    banner.append(bannerLeft, bannerActions);
    portal.append(banner);

    // 2. 搜索与直达 FID 栏
    const searchWrap = node('div', 'board-portal-search-wrap');
    const searchIcon = node('span', '', '🔍');
    const searchInput = node('input', 'board-portal-search-input');
    searchInput.type = 'search';
    searchInput.placeholder = '搜索板块名称、描述，或直接输入数字 FID 快速跳转…';
    const jumpFidBtn = button('', 'board-portal-jump-fid', () => {
      const fid = searchInput.value.trim();
      if (fid) location.href = `/thread.php?fid=${fid}`;
    });
    jumpFidBtn.hidden = true;
    searchWrap.append(searchIcon, searchInput, jumpFidBtn);
    portal.append(searchWrap);

    // 3. 分类导航分栏标签条 (Segmented Category Bar)
    const catBar = node('div', 'board-portal-cat-bar');
    let currentFilter = 'all';

    const createCard = (forum) => {
      const targetUrl = forum.url || (forum.stid ? `/thread.php?stid=${forum.stid}` : `/thread.php?fid=${forum.fid}`);
      const card = link(targetUrl, '', 'board-portal-card board-card');

      const topRow = node('div', 'board-portal-card-top board-card-main');
      topRow.append(node('span', 'board-portal-card-name board-card-name', forum.name));
      const fidText = forum.fid ? `FID ${forum.fid}` : (forum.stid ? `STID ${forum.stid}` : '');
      if (fidText) topRow.append(node('span', 'board-portal-card-fid board-card-fid', fidText));
      card.append(topRow);

      if (forum.desc) {
        card.append(node('div', 'board-portal-card-desc board-card-desc', forum.desc));
      }

      card.addEventListener('click', () => {
        recordRecentBoard(forum);
      });
      return card;
    };

    const renderSections = () => {
      sectionsContainer.replaceChildren();
      const query = searchInput.value.trim().toLowerCase();

      // 搜索模式
      if (query) {
        catBar.hidden = true;
        const matched = [];
        const seenFids = new Set();
        for (const cat of categories) {
          for (const forum of cat.forums) {
            const fidStr = String(forum.fid || forum.stid || '');
            if (seenFids.has(fidStr)) continue;
            if (forum.name.toLowerCase().includes(query) || (forum.desc && forum.desc.toLowerCase().includes(query)) || fidStr.includes(query)) {
              seenFids.add(fidStr);
              matched.push(forum);
            }
          }
        }

        const searchSection = node('div', 'board-portal-section');
        const sHead = node('div', 'board-portal-section-header');
        sHead.append(
          node('div', 'board-portal-section-title', `🔍 搜索结果（找到 ${matched.length} 个板块）`)
        );
        searchSection.append(sHead);

        if (!matched.length) {
          const empty = node('div', 'board-empty-search');
          empty.innerHTML = `未找到包含 "<strong>${query}</strong>" 的板块。若知道版面 ID，可直接点击右侧直达按钮。`;
          searchSection.append(empty);
        } else {
          const grid = node('div', 'board-portal-cards-grid board-cards-grid');
          for (const f of matched) {
            grid.append(createCard(f));
          }
          searchSection.append(grid);
        }
        sectionsContainer.append(searchSection);
        return;
      }

      catBar.hidden = false;

      // 最近访问展示（在全部或最近激活时）
      const recent = readRecentBoards();
      if (recent.length && (currentFilter === 'all' || currentFilter === 'recent')) {
        const rSec = node('div', 'board-portal-section board-section-recent');
        const rHead = node('div', 'board-portal-section-header');
        const rTitle = node('div', 'board-portal-section-title', '🕒 最近访问板块');
        const rClear = button('清空历史', 'board-clear-recent', () => {
          clearRecentBoards();
          renderSections();
        });
        rHead.append(rTitle, rClear);
        rSec.append(rHead);

        const rGrid = node('div', 'board-portal-cards-grid board-chips-grid');
        for (const f of recent) {
          rGrid.append(createCard(f));
        }
        rSec.append(rGrid);
        sectionsContainer.append(rSec);
      }

      // 各栏目分栏展示
      for (const cat of categories) {
        if (currentFilter !== 'all' && currentFilter !== cat.id) continue;

        const sec = node('div', 'board-portal-section');
        const sHead = node('div', 'board-portal-section-header board-section-title');
        const sTitleWrap = node('div', 'board-portal-section-title');
        sTitleWrap.append(
          node('span', '', `${cat.icon} ${cat.name}`),
          node('span', 'board-portal-section-count', `${cat.forums.length} 个板块`)
        );
        const sDesc = node('div', 'board-portal-section-desc', cat.desc || '');
        sHead.append(sTitleWrap, sDesc);
        sec.append(sHead);

        const grid = node('div', 'board-portal-cards-grid board-cards-grid');
        for (const forum of cat.forums) {
          grid.append(createCard(forum));
        }
        sec.append(grid);
        sectionsContainer.append(sec);
      }
    };

    // 组织分类导航条按钮
    const catTabs = [{ id: 'all', name: '全部板块', icon: '🌐' }];
    const recent = readRecentBoards();
    if (recent.length) {
      catTabs.push({ id: 'recent', name: '最近访问', icon: '🕒' });
    }
    for (const cat of categories) {
      catTabs.push({ id: cat.id, name: cat.name, icon: cat.icon });
    }

    for (const tabItem of catTabs) {
      const btn = button(`${tabItem.icon} ${tabItem.name}`, `board-portal-cat-btn${tabItem.id === currentFilter ? ' is-active' : ''}`, () => {
        currentFilter = tabItem.id;
        for (const b of catBar.querySelectorAll('.board-portal-cat-btn')) {
          b.classList.toggle('is-active', b === btn);
        }
        renderSections();
      });
      catBar.append(btn);
    }
    portal.append(catBar);

    // 4. 分栏内容总容器
    const sectionsContainer = node('div', 'board-portal-sections');
    portal.append(sectionsContainer);

    // 搜索输入交互
    searchInput.addEventListener('input', () => {
      const val = searchInput.value.trim();
      if (/^-?\d+$/.test(val)) {
        jumpFidBtn.hidden = false;
        jumpFidBtn.textContent = `进入 FID ${val} ➔`;
      } else {
        jumpFidBtn.hidden = true;
      }
      renderSections();
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = searchInput.value.trim();
        if (/^-?\d+$/.test(val)) {
          location.href = `/thread.php?fid=${val}`;
        }
      }
    });

    renderSections();
  }

  return {
    open,
    close,
    dialog,
    FORUM_CATEGORIES,
    FORUM_MAP,
    detectBoardInfo,
    extractCurrentSubforums,
    recordRecentBoard,
    readRecentBoards,
    clearRecentBoards,
    renderSubforumStrip,
    renderPortalView
  };
}

  const boardsManager = mountBoardsManager({ context: window, shadow, app, pageURL, prefs, savePrefs });
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
  settings.append(accountButton, button('切换板块', 'settings-boards', () => boardsManager.open()), button('阅读设置', 'settings-reading', () => readingSettings.open()), button('原版页面 ↗', 'settings-native', () => toggle(false)));
  intro.append(heading, settings);
  const tabs = node('nav', 'tabs'); tabs.setAttribute('aria-label', '帖子筛选'); tabs.setAttribute('role', 'tablist');
  for (const [id, label] of [['all', '全部'], ['hot', '热议'], ['saved', '收藏']]) {
    const b = button(label, '', () => { tab = id; render(); }); b.dataset.tab = id; b.setAttribute('role', 'tab'); tabs.append(b);
  }
  const grid = node('section', 'grid'); grid.setAttribute('aria-label', '帖子卡片');
  // 手势期间只收集更新，避免按下与抬手之间改变卡片几何位置。
  let listInteraction = false;
  for (const type of ['wheel', 'touchstart', 'keydown', 'click']) app.addEventListener(type, () => { listInteraction = true; markListActivity(); }, { passive: true, capture: true });
  // 链接的原生聚焦可能把半露出的卡片滚入视口。保留聚焦与点击语义，禁止聚焦滚动。
  grid.addEventListener('mousedown', event => {
    const cover = event.target.closest?.('a.cover');
    if (!cover || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); cover.focus({ preventScroll: true });
  });
  const empty = node('div', 'empty'), pager = node('nav', 'pager'); pager.setAttribute('aria-label', '论坛分页');
  main.append(intro, subforumStrip, tabs, grid, empty, pager, node('div', 'foot', '按原站顺序追加 · 热议为已加载帖子回复 ≥ 100 · 收藏仅存本浏览器'));
  app.append(top, main);
  const restore = button('卡片模式', 'restore', () => toggle(true)); restore.hidden = true;
  shadow.append(app, restore); document.documentElement.append(host);
  readingSettings = mountSettings({ context: window, shadow, app, prefs, cache: postCache, save: savePrefs, change: () => { if (prefs.smoothNavigation === false) navigation.finish(); settingsRefresh(); if (!app.classList.contains('reader')) configureListRefresh(); settings.querySelectorAll('input').forEach(c => { c.checked = !!prefs['single']; }); }, original: () => modeToggle(false), login: openLogin, openBoards: () => boardsManager?.open() });
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
    app.hidden = !enabled || (!items.length && !listBootPending && !isForumRoot);
    restore.hidden = enabled || (!items.length && !isForumRoot);
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
    if (!usesDocumentScroll() || document.documentElement.hasAttribute('data-readscape-reader-open') || document.documentElement.hasAttribute('data-readscape-modal-open')) return;
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
  let listCursor = firstListPage, listNext = null, listBusy = false, listFailed = false, listController;
  let listBootPending = !!(postCache && window.indexedDB && prefs.enabled !== false);
  let listFromCache = false, pendingListPage, refreshController;
  const pendingListCovers = new Map(), listPointers = new Set();
  let listActivityAt = 0, listUpdateTimer, autoRefreshTimer, pendingAutomatic = false;
  let pullStart, pullDistance = 0, pullCancelled = false;
  const pullIndicator = node('div', 'list-pull', '下拉刷新'); pullIndicator.setAttribute('role', 'status'); app.prepend(pullIndicator);
  function readerCoversList() { return !!document.querySelector('iframe[data-readscape-reader]'); }
  function markListActivity() { listActivityAt = Date.now(); scheduleListUpdate(); }
  function listCanUpdate() {
    return !coverDisposed && !app.hidden && !document.hidden && !readerCoversList() && !listPointers.size && !pullStart && !listBusy && !app.classList.contains('rt-settings-open') && Date.now() - listActivityAt >= 650;
  }
  function applyListCovers() {
    if (!pendingListCovers.size || coverDisposed) return;
    const position = getReadingScroll();
    const anchor = [...grid.children].find(card => card.getBoundingClientRect().bottom > top.getBoundingClientRect().bottom);
    const anchorTop = anchor?.getBoundingClientRect().top;
    const before = new Map([...grid.children].map(card => [card.dataset.tid, { card, html: card.innerHTML }]));
    for (const [tid, cached] of pendingListCovers) {
      const card = listCards.get(tid)?.card;
      if (card?.isConnected) setCardCover(card, cached);
    }
    pendingListCovers.clear(); layoutMasonry();
    if (position <= 2) setReadingScroll(0);
    else if (anchor?.isConnected) setReadingScroll(position + anchor.getBoundingClientRect().top - anchorTop);
    for (const card of grid.children) {
      const old = before.get(card.dataset.tid);
      if (old && old.html !== card.innerHTML) {
        card.classList.remove('card-updated'); void card.offsetWidth; card.classList.add('card-updated');
        card.addEventListener('animationend', () => card.classList.remove('card-updated'), { once: true });
      }
    }
    if (!pendingListPage) {
      refreshBar.classList.remove('has-update');
      refreshButton.hidden = true;
    }
  }
  function queueListCover(card, cached) {
    pendingListCovers.set(card.dataset.tid, cached);
    if (!readerCoversList() && !listInteraction) {
      applyListCovers();
    } else if (prefs.autoListRefresh !== false) {
      pendingAutomatic = true;
      scheduleListUpdate();
    }
  }
  function scheduleListUpdate() {
    clearTimeout(listUpdateTimer);
    if (!pendingAutomatic || !pendingListPage && !pendingListCovers.size || coverDisposed) return;
    listUpdateTimer = setTimeout(() => {
      if (listCanUpdate()) applyListUpdate(false);
      else if (!document.hidden && !readerCoversList() && !app.hidden) scheduleListUpdate();
    }, 700);
  }
  function stopListRefresh() { clearTimeout(autoRefreshTimer); clearTimeout(listUpdateTimer); autoRefreshTimer = listUpdateTimer = null; }
  function configureListRefresh() {
    clearTimeout(autoRefreshTimer);
    if (prefs.autoListRefresh === false) { pendingAutomatic = false; clearTimeout(listUpdateTimer); return; }
    if (coverDisposed || app.classList.contains('reader')) return;
    autoRefreshTimer = setTimeout(async () => {
      if (!document.hidden && !app.hidden && !readerCoversList() && !listBootPending && !listBusy) await revalidateList();
      configureListRefresh();
    }, 10000);
    if (pendingListPage || pendingListCovers.size) { pendingAutomatic = true; scheduleListUpdate(); }
  }
  document.addEventListener('visibilitychange', () => { configureListRefresh(); scheduleListUpdate(); });
  window.addEventListener('pageshow', () => { applyListCovers(); configureListRefresh(); });
  document.addEventListener('readscape-list-resume', () => { listPointers.clear(); applyListCovers(); listActivityAt = Date.now() + 600; scheduleListUpdate(); });
  function showNotice(message, title = '提示') {
    let dialog = app.querySelector('.notice-dialog');
    if (!dialog) {
      dialog = node('dialog', 'notice-dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', title);
      const head = node('div', 'notice-dialog-title', title);
      const msg = node('div', 'notice-dialog-msg');
      const actions = node('div', 'notice-dialog-actions');
      const ok = button('确定', 'notice-dialog-btn', () => close());
      actions.append(ok);
      dialog.append(head, msg, actions);
      dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
      dialog.addEventListener('cancel', () => close());
      app.append(dialog);
    }
    const msg = dialog.querySelector('.notice-dialog-msg');
    if (msg) msg.textContent = message;
    const titleEl = dialog.querySelector('.notice-dialog-title');
    if (titleEl) titleEl.textContent = title;
    dialog.setAttribute('aria-label', title);
    const returnFocus = shadow.activeElement || document.activeElement;
    function close() {
      if (dialog.open) {
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      }
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      else grid.focus?.({ preventScroll: true });
    }
    if (typeof dialog.showModal === 'function') {
      try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); }
    } else if (typeof dialog.show === 'function') {
      dialog.show();
    } else {
      dialog.setAttribute('open', '');
    }
    dialog.querySelector('.notice-dialog-btn')?.focus({ preventScroll: true });
    return { dialog, close };
  }
  function removeDeletedCard(tid) {
    const entry = listCards.get(tid);
    const card = entry?.card || grid.querySelector(`[data-tid="${tid}"]`);
    if (card) {
      cardObserver?.unobserve(card);
      card.remove();
      listCards.delete(tid);
    }
    items = items.filter(item => item.tid !== tid);
    for (const page of listPages.values()) {
      if (Array.isArray(page?.items)) {
        page.items = page.items.filter(item => item.tid !== tid);
      }
    }
    if (favorites[tid]) {
      delete favorites[tid];
      favoriteChanges.add(tid);
      postCache?.setFavorite({ tid }, false);
    }
    cacheListPages();
    postCache?.remove([tid]);
    layoutMasonry();
    const source = tab === 'saved' ? Object.values(favorites) : items;
    const visibleCount = source.filter(item => (tab !== 'hot' || item.replies >= 100) && (!query || `${item.title} ${item.author}`.toLowerCase().includes(query))).length;
    subtitle.textContent = `第 ${firstListPage}${listPages.size > 1 ? `–${listCursor}` : ''} 页 · ${visibleCount} 篇${query ? ' · 已加载搜索' : ''}`;
    empty.hidden = visibleCount > 0;
    updateListControls();
  }
  const handlePostDeleted = event => {
    const { tid } = event.detail || {};
    if (!tid) return;
    const entry = listCards.get(tid);
    const title = entry?.card?.item?.title || entry?.card?.querySelector?.('.title')?.textContent || '';
    removeDeletedCard(tid);
    showNotice(title ? `“${title}” 帖子已被删除，已从瀑布流中移除。` : '该帖子已被删除，已从瀑布流中移除。');
  };
  document.addEventListener('readscape-post-deleted', handlePostDeleted);
  window.addEventListener('pagehide', () => document.removeEventListener('readscape-post-deleted', handlePostDeleted));
  window.addEventListener('popstate', () => { applyListCovers(); listActivityAt = Date.now() + 600; scheduleListUpdate(); });
  app.addEventListener('pointerdown', event => { listInteraction = true; listPointers.add(event.pointerId); markListActivity(); }, { passive: true, capture: true });
  const releasePointer = event => { listPointers.delete(event.pointerId); markListActivity(); };
  window.addEventListener('pointerup', releasePointer, { passive: true }); window.addEventListener('pointercancel', releasePointer, { passive: true });
  for (const target of [app, window]) target.addEventListener('scroll', markListActivity, { passive: true });
  function resetPull() { pullStart = null; pullDistance = 0; pullIndicator.classList.remove('is-visible', 'is-ready'); }
  app.addEventListener('touchstart', event => {
    resetPull();
    if (!streamKey || app.classList.contains('reader') || document.documentElement.hasAttribute('data-readscape-modal-open') || (event.touches?.length || 0) !== 1 || getReadingScroll() > 2 || app.hidden || readerCoversList() || app.classList.contains('rt-settings-open') || app.classList.contains('boards-open') || event.composedPath().some(el => el?.closest?.('.board-dialog, .notice-dialog, .rt-mask, .subforum-strip, .tabs') || el?.matches?.('input,button,a'))) return;
    const point = event.touches[0]; pullStart = { x: point.clientX, y: point.clientY }; pullCancelled = false;
  }, { passive: true });
  app.addEventListener('touchmove', event => {
    if (!pullStart || (event.touches?.length || 0) !== 1 || pullCancelled) { resetPull(); return; }
    markListActivity();
    const point = event.touches[0], delta = point.clientY - pullStart.y;
    if (getReadingScroll() > 2 || Math.abs(point.clientX - pullStart.x) > 40 || delta < -8) { pullCancelled = true; resetPull(); return; }
    pullDistance = Math.min(120, Math.max(0, delta));
    if (pullDistance > 12) { event.preventDefault(); pullIndicator.classList.add('is-visible'); }
    pullIndicator.classList.toggle('is-ready', pullDistance >= 72);
    pullIndicator.textContent = refreshController ? '正在刷新…' : pullDistance >= 72 ? '松开刷新' : '继续下拉刷新';
  }, { passive: false });
  app.addEventListener('touchend', () => {
    const refresh = pullStart && pullDistance >= 72 && !pullCancelled;
    resetPull(); markListActivity();
    if (refresh) revalidateList({ force: true });
  }, { passive: true });
  app.addEventListener('touchcancel', resetPull, { passive: true });
  const refreshBar = node('div', 'list-refresh-bar');
  const refreshStatus = node('span', 'list-refresh-status', '正在准备列表…'); refreshStatus.setAttribute('role', 'status');
  const refreshButton = button('更新列表', 'list-refresh', () => applyListUpdate()); refreshButton.hidden = true;
  refreshBar.append(refreshStatus, refreshButton); main.insertBefore(refreshBar, grid);
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
    const nextURL = new URL(base); nextURL.searchParams.set('page', number + 1); nextURL.hash = '';
    // 原站分页栏可能尚未生成，抓取的 HTML 也不会执行生成分页的脚本。
    let metadata = doc === document ? ngaPageContext(window).__PAGE : null;
    if (!metadata) {
      const literal = [...doc.scripts].map(script => script.textContent).join('\n').match(/\b__PAGE\s*=\s*\{([^}]+)\}/)?.[1];
      if (literal) {
        metadata = {};
        for (const match of literal.matchAll(/(?:^|,)\s*['"]?([123])['"]?\s*:\s*(\d+)/g)) metadata[match[1]] = Number(match[2]);
      }
    }
    if (Number.isSafeInteger(Number(metadata?.[1])) && Number(metadata[1]) >= 0 && Number(metadata[3]) > 0) {
      return number < Math.ceil((Number(metadata[1]) + 1) / Number(metadata[3])) ? nextURL.href : null;
    }
    for (const a of doc.querySelectorAll('a[href]')) {
      const next = validListURL(safeURL(a.getAttribute('href'), base)?.href, number + 1);
      if (next) return next;
    }
    // 缺少分页信息不代表末页；按原站 page 参数尝试，重复页和错误响应会停止加载。
    return nextURL.href;
  }
  function cacheListPages() {
    if (!streamKey) return;
    const snapshot = new Map(listPages);
    if (pendingListPage) snapshot.set(firstListPage, pendingListPage);
    postCache?.saveListPages(streamKey, snapshot);
  }
  function cachedPages(cache) {
    const restored = new Map();
    let number = firstListPage;
    while (true) {
      const page = cache?.find(p => p.number === number && validListURL(p.url, number));
      if (!page || !page.items.length || !page.items.every(validCachedItem) || page.next && !validListURL(page.next, number + 1)) break;
      const next = page.next || nextListURL(document, number, page.url);
      restored.set(number, { url: page.url, items: page.items, next });
      if (!page.next) break;
      number++;
    }
    return restored;
  }
  async function startList() {
    if (typeof isForumRoot !== 'undefined' && isForumRoot) { listBootPending = false; scan(); return; }
    if (!listBootPending) { scan(); return; }
    const generation = postCache.generation;
    app.classList.add('list-preparing'); updateListHeading(); toggle(true); renderPager();
    let cache, cacheTimeout;
    try { cache = await Promise.race([postCache.getListPages(streamKey), new Promise(resolve => { cacheTimeout = setTimeout(() => resolve(null), 1200); })]); } catch {}
    finally { clearTimeout(cacheTimeout); app.classList.remove('list-preparing'); }
    if (coverDisposed) return;
    const restored = generation === postCache.generation ? cachedPages(cache) : new Map();
    listBootPending = false;
    if (!restored.size) { refreshStatus.textContent = '列表已就绪'; scan(); observeListEnd(); return; }
    for (const [number, page] of restored) listPages.set(number, page);
    listCursor = [...restored.keys()].at(-1); listNext = listPages.get(listCursor).next;
    listFromCache = true; mergeListPages(); toggle(prefs.enabled !== false); renderPager(); observeListEnd();
    refreshStatus.textContent = '已显示缓存，正在后台更新…';
    revalidateList();
  }
  function pageSignature(page) {
    // 相对时间、分页和排序变化不代表帖子有新内容；兼容旧缓存缺省字段。
    return JSON.stringify(page?.items.map(({tid,title,author,uid,replies,url,latest,pinned}) => ({
      tid, title, author, uid: uid || null, replies: replies ?? null, url,
      latest: latest || url, pinned: !!pinned
    })).sort((a, b) => a.tid.localeCompare(b.tid)));
  }
  function stageListPage(page, force = false) {
    if (pageSignature(page) === pageSignature(listPages.get(firstListPage))) {
      listPages.get(firstListPage).next = page.next;
      listNext = listPages.get(listCursor).next; updateListControls();
      pendingListPage = null; refreshBar.classList.remove('has-update'); refreshButton.hidden = true; refreshStatus.textContent = '列表已是最新'; pendingAutomatic = force || prefs.autoListRefresh !== false; scheduleListUpdate(); return;
    }
    pendingListPage = page; refreshBar.classList.add('has-update'); refreshButton.hidden = false;
    refreshStatus.textContent = '有新内容，更新后查看'; refreshButton.textContent = '更新列表';
    pendingAutomatic = force || prefs.autoListRefresh !== false; scheduleListUpdate();
  }
  function applyListUpdate(manual = true) {
    if (readerCoversList() || listPointers.size) { pendingAutomatic = true; scheduleListUpdate(); return; }
    if (!pendingListPage && !pendingListCovers.size) { if (manual) revalidateList({ force: true }); return; }
    const position = getReadingScroll();
    const anchor = [...grid.children].find(card => card.getBoundingClientRect().bottom > top.getBoundingClientRect().bottom);
    const anchorTop = anchor?.getBoundingClientRect().top;
    const before = new Map([...grid.children].map(card => [card.dataset.tid, { card, html: card.innerHTML }]));
    if (pendingListPage) {
      // 自动更新不挪动已有帖子的顺序；离开顶部时新帖子追加到末尾。
      const page = { ...pendingListPage, items: [...pendingListPage.items] }, fresh = new Map(page.items.map(item => [item.tid, item]));
      if (!manual && position > 2) {
        page.items = listPages.get(firstListPage).items.map(item => fresh.get(item.tid) || item);
        const present = new Set(page.items.map(item => item.tid));
        page.items.push(...[...fresh.values()].filter(item => !present.has(item.tid)));
      }
      listPages.set(firstListPage, page); pendingListPage = null;
      listNext = listPages.get(listCursor).next; mergeListPages(); cacheListPages(); render();
    }
    applyListCovers();
    pendingAutomatic = false;
    if (!pendingListPage) {
      refreshBar.classList.remove('has-update');
      refreshButton.hidden = true;
      refreshStatus.textContent = '列表已更新';
    }
  }
  async function fetchListPage(url, number, signal) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-cache', signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!validListURL(response.url || url, number)) throw new Error('原站返回了其他页面');
    const bytes = new Uint8Array(await response.arrayBuffer()), initial = new TextDecoder('utf-8').decode(bytes);
    const encoding = response.headers.get('content-type')?.match(/charset\s*=\s*([\w-]+)/i)?.[1] || initial.slice(0,4096).match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || 'utf-8';
    const doc = new DOMParser().parseFromString(new TextDecoder(encoding).decode(bytes), 'text/html');
    const found = extract(doc, url);
    if (!found.length) throw new Error('需要原站跳转、登录，或页面结构不支持');
    return { url, items: found.map(item => ({ ...item, lastAccess: Date.now() })), next: nextListURL(doc, number, url) };
  }
  async function revalidateList({ force = false } = {}) {
    if (!streamKey || app.classList.contains('reader') || refreshController || coverDisposed) return;
    const generation = postCache?.generation;
    const controller = refreshController = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    refreshBar.classList.add('is-loading'); refreshStatus.textContent = '正在后台更新…'; refreshButton.hidden = true;
    try {
      const page = await fetchListPage(pageURL.href, firstListPage, controller.signal);
      if (controller.signal.aborted || coverDisposed || generation !== postCache?.generation) return;
      // 写入新快照，当前已呈现的列表保持不动，等待用户主动更新。
      const snapshot = new Map(listPages); snapshot.set(firstListPage, page); postCache?.saveListPages(streamKey, snapshot);
      listFromCache = true; stageListPage(page, force);
    } catch {
      if (!coverDisposed) { refreshStatus.textContent = '后台更新失败，仍可浏览缓存'; refreshBar.classList.add('has-update'); refreshButton.textContent = pendingListPage ? '更新列表' : '重试更新'; refreshButton.hidden = false; }
    } finally { clearTimeout(timeout); refreshController = null; refreshBar.classList.remove('is-loading'); }
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
    const page = { url: pageURL.href, items: found, next: nextListURL(document, firstListPage, pageURL.href) };
    if (listPages.has(firstListPage) && listCursor === firstListPage && listNext !== page.next) {
      listPages.get(firstListPage).next = listNext = page.next;
      cacheListPages();
    }
    if (listFromCache) return;
    if (listInteraction) { revalidateList(); return; }
    listPages.set(firstListPage, page);
    listNext = listPages.get(listCursor).next;
    mergeListPages(); cacheListPages();
  }
  function updateListControls() {
    grid.setAttribute('aria-busy', String(listBusy || listBootPending));
    listLoad.disabled = listBusy || listBootPending;
    listLoad.hidden = !listNext;
    listLoad.textContent = listBusy ? '正在加载…' : listFailed ? '重试下一页' : '加载下一页';
    if (listNext && listStatus.textContent === '已经到底了') listStatus.textContent = '';
    if (!listNext && items.length) listStatus.textContent = '已经到底了';
  }
  async function loadNextListPage() {
    if (listBusy || listBootPending || !listNext || app.hidden) return;
    const url = listNext, number = listCursor + 1;
    listBusy = true; listFailed = false; updateListControls(); listStatus.textContent = `正在读取第 ${number} 页…`;
    const controller = listController = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const page = await fetchListPage(url, number, controller.signal), found = page.items;
      if (controller.signal.aborted) return;
      if (!found.some(item => !items.some(existing => existing.tid === item.tid))) {
        listNext = null; listStatus.textContent = '原站未返回新帖子，已停止重复加载。'; return;
      }
      listNext = page.next;
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


  // 每张卡片固定所在列，列内按实测高度累加。自动网格排位会因某张卡片增高
  // 把后续卡片换到另一列；显式行列位置让封面、字体加载与追加只影响所在列。
  function layoutMasonry() {
    if (!grid.isConnected || !grid.classList.contains('masonry')) return;
    const tracks = window.getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/);
    const columns = Math.max(1, tracks.length);
    const rows = Array(columns).fill(1);
    const cards = [...grid.children];
    cards.forEach((card, index) => { card.style.gridColumn = String(index % columns + 1); });
    const spans = cards.map(card => Math.max(1, Math.ceil(((card.getBoundingClientRect().height || card.offsetHeight) + 18) / 4)));
    cards.forEach((card, index) => {
      const column = index % columns;
      const start = String(rows[column]), end = `span ${spans[index]}`;
      if (card.style.gridRowStart !== start) card.style.gridRowStart = start;
      if (card.style.gridRowEnd !== end) card.style.gridRowEnd = end;
      rows[column] += spans[index];
    });
  }
  function sizeCard(card) { if (card?.isConnected) layoutMasonry(); }

  // 封面直接引用原图地址，由浏览器 HTTP 缓存承担复用；缓存只记录地址。
  function applyCachedCover(card, tid) {
    if (!postCache || card.coverLoading) return;
    card.coverLoading = true;
    const generation = postCache.generation;
    postCache.getCover(tid).then(cached => {
      if (!cached || coverDisposed || generation !== postCache.generation || !card.isConnected) return;
      if (card.coverSignature === JSON.stringify([cached.source, cached.width || 0, cached.height || 0])) return;
      if (listInteraction || readerCoversList()) queueListCover(card, cached);
      else setCardCover(card, cached);
    }).catch(() => {}).finally(() => { card.coverLoading = false; });
  }
  function setCardCover(card, cached) {
    const cover = card.querySelector('.cover');
    if (!cover || card.coverSignature === JSON.stringify([cached.source, cached.width || 0, cached.height || 0])) return;
    const image = node('img'); image.alt = ''; image.decoding = 'async'; image.loading = 'lazy';
    // 已有比例时先占位，避免图片加载后卡片高度变化导致滚动中点击偏移。
    if (cached.width > 0 && cached.height > 0) image.style.aspectRatio = `${cached.width} / ${cached.height}`;
    // 立即入树：lazy 图片脱离文档不会触发加载；比例已占位，加载前后布局不变。
    image.className = 'cached-cover-image';
    image.onerror = () => { image.onerror = null; image.removeAttribute('src'); image.alt = '封面暂时不可用'; image.classList.add('cover-image-error'); };
    // 无占位比例时图片加载完才增高，加载后补算一次跨度。
    image.addEventListener('load', () => sizeCard(card), { once: true });
    cover.querySelector('.cached-cover-image')?.remove();
    cover.prepend(image); cover.classList.add('cached-cover'); card.coverSource = cached.source; card.coverSignature = JSON.stringify([cached.source, cached.width || 0, cached.height || 0]);
    image.src = cached.source;
    if (image.naturalWidth > 0 && image.naturalHeight > 0 && !image.style.aspectRatio) image.style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
    // 占位比例已确定高度，立即重算跨度，避免与下方卡片重叠。
    sizeCard(card);
  }
  const unsubscribeCache = postCache?.subscribe(event => {
    if (event.type === 'cover') { const card = listCards.get(event.tid)?.card; if (card) applyCachedCover(card, event.tid); }
    if (event.type === 'clear') {
      pendingListCovers.clear();
      for (const {card} of listCards.values()) { card.querySelector('.cached-cover-image')?.remove(); card.querySelector('.cover')?.classList.remove('cached-cover'); card.coverSource = null; card.coverSignature = null; }
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
    if (listBootPending) return;
    if (isForumRoot) {
      h1Text.textContent = '选择论坛板块';
      subtitle.textContent = 'NGA 拥有众多精彩子论坛，请选择您想浏览的板块';
      switchBadge.hidden = true;
      subforumStrip.hidden = true;
      tabs.hidden = true;
      grid.hidden = true;
      pager.hidden = true;
      if (typeof refreshBar !== 'undefined') refreshBar.hidden = true;
      boardsManager.renderPortalView(main, empty);
      toggle(prefs.enabled !== false);
      return;
    }
    const found = extract();
    const sig = JSON.stringify([found, nextListURL(document, firstListPage, pageURL.href)]);
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
    updateListHeading();
    toggle(prefs.enabled !== false);
    renderPager();
    observeListEnd();
  }

  function updateListHeading() {
    if (isForumRoot) {
      switchBadge.hidden = true;
      subforumStrip.hidden = true;
      return;
    }
    const info = boardsManager.detectBoardInfo(document, window, pageURL);
    h1Text.textContent = info.name;
    switchBadge.hidden = false;
    boardsManager.recordRecentBoard({ fid: info.fid, stid: info.stid, name: info.name, url: location.href });
    boardsManager.renderSubforumStrip(subforumStrip);
  }

  function renderPager() {
    pager.replaceChildren();
    pager.append(listLoad, listStatus, button('原版翻页', 'pill', () => toggle(false)));
    updateListControls();
  }

  const palette = ['#f5e7df', '#e5ebdf', '#e7e8f3', '#f5e5e8', '#e0edef', '#f2eddf'];
  const color = tid => palette[Number(tid.slice(-4)) % palette.length];
  const count = n => n == null ? '讨论' : n >= 10000 ? `${(n / 10000).toFixed(1)}万回复` : `${n} 回复`;

  // 列表滚动位置跨整页加载保留。平滑阅读用 iframe 覆盖列表、位置天然不动；但整页
  // 跳转 / 刷新 / 新标签打开时列表会重建，而卡片是异步渲染的——浏览器原生滚动恢复
  // 触发那一刻页面还很短，会被夹回顶部。于是自己按列表地址存一份，返回或刷新后等
  // 卡片把高度撑起来再滚回去，做到"从哪来回哪去"。
  const listNavType = (() => {
    const nav = window.performance?.getEntriesByType?.('navigation')?.[0];
    if (nav?.type) return nav.type;
    const legacy = window.performance?.navigation?.type;
    return legacy === 2 ? 'back_forward' : legacy === 1 ? 'reload' : 'navigate';
  })();
  let listScrollRestored = false, listScrollTries = 0, listScrollSaveTimer;
  const listScrollKey = () => `${KEY}-scroll-${streamKey}#${firstListPage}`;
  function saveListScroll() {
    // 阅读态由 navigation 自己记住列表位置；此处只在浏览列表时记录，避免覆盖成阅读页的滚动。
    if (!streamKey || document.documentElement.hasAttribute('data-readscape-reader-open')) return;
    try { sessionStorage.setItem(listScrollKey(), JSON.stringify({ y: Math.round(getReadingScroll()), at: Date.now() })); } catch { /* 存储被禁用时忽略 */ }
  }
  function cancelListRestore() { listScrollRestored = true; }
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) app.addEventListener(type, cancelListRestore, { passive: true, capture: true });
  function restoreListScroll() {
    if (listScrollRestored || !streamKey || app.hidden) return;
    if (listNavType !== 'back_forward' && listNavType !== 'reload') { listScrollRestored = true; return; }
    let saved; try { saved = JSON.parse(sessionStorage.getItem(listScrollKey()) || 'null'); } catch { saved = null; }
    if (!saved || !(saved.y > 0) || Date.now() - saved.at > 30 * 60000) { listScrollRestored = true; return; }
    // 高度不足时先等待，卡片渲染 / 翻页 hydrate 完成后才能滚到目标位置。
    const room = usesDocumentScroll() ? document.documentElement.scrollHeight - window.innerHeight : app.scrollHeight - app.clientHeight;
    if (room < saved.y - 4 && listScrollTries++ < 50) { window.setTimeout(restoreListScroll, 60); return; }
    listScrollRestored = true;
    setReadingScroll(saved.y);
  }
  window.addEventListener('scroll', () => {
    if (listScrollSaveTimer) return;
    listScrollSaveTimer = window.setTimeout(() => { listScrollSaveTimer = null; saveListScroll(); }, 250);
  }, { passive: true });
  window.addEventListener('pagehide', saveListScroll);

  function render(cacheVisit = true) {
    if (isForumRoot) return;
    grid.classList.toggle('single', !!prefs.single);
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    // 收藏包含曾浏览过的其他页；全部与热议保持已加载页面的原始顺序。
    const source = tab === 'saved' ? Object.values(favorites) : items;
    const visible = source.filter(item => (tab !== 'hot' || item.replies >= 100) && (!query || `${item.title} ${item.author}`.toLowerCase().includes(query)));
    if (cacheVisit && !listBootPending) postCache?.visit(listFromCache || pendingListPage ? visible.map(({tid}) => ({tid})) : visible);
    subtitle.textContent = `第 ${firstListPage}${listPages.size > 1 ? `–${listCursor}` : ''} 页 · ${visible.length} 篇${query ? ' · 已加载搜索' : ''}`;
    empty.textContent = listBootPending ? '正在准备列表…' : tab === 'saved' ? '点击卡片上的 ♡ 收藏帖子。' : '没有符合条件的帖子。';
    empty.hidden = visible.length > 0;
    const retained = new Set(visible.map(item => item.tid));
    for (const card of [...grid.children]) if (!retained.has(card.dataset.tid)) { cardObserver?.unobserve(card); card.remove(); }
    for (const [index, item] of visible.entries()) {
      const { lastAccess, updatedAt, contentHtml, coverId, ...appearance } = item;
      const signature = JSON.stringify(appearance);
      let entry = listCards.get(item.tid);
      if (entry && entry.signature !== signature) {
        updateCard(entry.card, item); entry.signature = signature;
      }
      if (!entry) {
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
      cardObserver ||= new window.ResizeObserver(layoutMasonry);
      grid.classList.add('masonry');
      layoutMasonry();
      cardObserver.observe(grid);
      for (const card of grid.children) cardObserver.observe(card);
    }
    updateListControls();
    restoreListScroll();
  }

  function makeCard(item) {
    const card = node('article', 'card'); card.item = item; card.classList.add('card-enter'); card.addEventListener('animationend', () => card.classList.remove('card-enter'), { once: true }); card.dataset.tid = item.tid; card.style.setProperty('--bg', color(item.tid));
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
      fav.classList.remove('save-pop'); void fav.offsetWidth; fav.classList.add('save-pop');
      const state = !!favorites[item.tid]; fav.textContent = state ? '♥' : '♡'; fav.setAttribute('aria-pressed', String(state));
      if (tab === 'saved') render();
    });
    fav.setAttribute('aria-label', '收藏帖子'); fav.setAttribute('aria-pressed', String(saved)); person.append(fav);
    const meta = node('div', 'meta'); meta.append(node('span', '', count(item.replies)), node('span', '', item.time));
    if (item.latest && item.latest !== item.url && new URL(item.latest).searchParams.has('page')) meta.append(link(item.latest, '最新回复', 'latest'));
    body.append(person, meta); card.append(cover, body);
    if (item.coverId && safeURL(item.coverId)) setCardCover(card, { source: item.coverId, width: item.coverW, height: item.coverH });
    return card;
  }

  function updateCard(card, incoming) {
    Object.assign(card.item, incoming);
    card.querySelector('.title').textContent = incoming.title;
    card.querySelector('.author').textContent = incoming.author || '作者未识别';
    card.querySelector('.avatar').textContent = incoming.author.slice(0, 1) || 'N';
    card.querySelector('.cover').href = incoming.url;
    const eye = card.querySelector('.eyebrow'); eye.replaceChildren(document.createTextNode('NGA · 讨论'));
    if (incoming.pinned || incoming.replies >= 100) eye.append(node('span', 'tag', incoming.pinned ? '置顶' : '热议'));
    const meta = card.querySelector('.meta'); meta.replaceChildren(node('span', '', count(incoming.replies)), node('span', '', incoming.time));
    if (incoming.latest && incoming.latest !== incoming.url && new URL(incoming.latest).searchParams.has('page')) meta.append(link(incoming.latest, '最新回复', 'latest'));
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
    const style = node('style', '', "\n      .reader .bar{max-width:1000px}.reader .brand{font-size:20px}.reader main{max-width:1000px;padding:32px 24px}\n      .reader h1{font-size:30px;line-height:1.5;letter-spacing:-.7px;overflow-wrap:anywhere}.reader-head{margin-bottom:22px}.reader-head .sub{margin-top:9px}\n      .reader-page{margin-bottom:28px}.page-heading{display:flex;align-items:center;gap:10px;color:#999;font-size:12px;margin:24px 0 14px}.page-heading:after{content:'';height:1px;background:#e8e8ed;flex:1}\n      .comment{padding:22px 24px;border:1px solid #ececf0;border-radius:18px;background:white;margin-bottom:12px;scroll-margin-top:105px;overflow:hidden}.comment.op{border-color:#f0e2db;margin:0 0 30px;padding:28px;background:#fffefa}.comment.flash{outline:3px solid #ff7994}\n      .comment-head{display:flex;align-items:center;gap:10px;margin-bottom:13px}.reader-avatar{height:34px;width:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--bg);color:#807570;font-size:13px;flex:none}.reader-author{font-size:13px;font-weight:700;overflow-wrap:anywhere}.comment-date{font-size:11px;color:#a0a0aa;margin-top:2px}.floor{font-size:11px;color:#a0a0aa;margin-left:auto;white-space:nowrap}.op-label{background:#ffede5;color:#b16e4e;font-size:10px;padding:2px 6px;border-radius:6px;margin-left:6px}\n      .comment-content{font-size:15px;line-height:1.95;overflow-wrap:anywhere;color:#414148}.comment-content p{margin:10px 0}.comment-content>p:first-child{margin-top:0}.reader{--content-link:#356b91;--content-link-visited:#785f91;--content-link-hover:#245477;--content-link-bg:#edf4fa}\n      .reader.rt-paper{--content-link:#396787;--content-link-visited:#78618b;--content-link-hover:#274e6a;--content-link-bg:#eaece7}\n      .reader.rt-dark{--content-link:#8fc8f0;--content-link-visited:#c3abe0;--content-link-hover:#b7deff;--content-link-bg:#293b4b}\n      .comment-content .content-link{color:var(--content-link);text-decoration-line:underline;text-decoration-color:color-mix(in srgb,var(--content-link) 40%,transparent);text-decoration-thickness:1px;text-underline-offset:.2em;text-decoration-skip-ink:auto;border-radius:3px;overflow-wrap:anywhere;transition:color .15s,background-color .15s}\n      .comment-content .content-link:visited{color:var(--content-link-visited)}\n      .comment-content .content-link:hover{color:var(--content-link-hover);background:var(--content-link-bg);text-decoration-color:currentColor}\n      .comment-content .content-link:focus-visible{outline:2px solid var(--content-link);outline-offset:3px;background:var(--content-link-bg)}\n      .comment-content .external-link:after{content:' ↗';display:inline-block;font-size:.8em;text-decoration:none;white-space:nowrap}\n      .comment-content img{max-width:100%;height:auto;border-radius:10px;display:block;margin:12px auto}.comment-content img.emoji{display:inline-block;width:auto;height:1.65em;max-width:3em;object-fit:contain;vertical-align:-.4em;margin:0 .2em;border-radius:0}\n      .reader.rt-dark .comment-content img.emoji{background:#f7f7f9;border-radius:4px}\n      .comment-content pre{overflow:auto;padding:12px;background:#f5f5f7;border-radius:10px;font-size:12px;white-space:pre}.comment-content code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}.comment-content table{display:block;overflow:auto;border-collapse:collapse;max-width:100%}.comment-content td,.comment-content th{border:1px solid #e7e7ec;padding:5px 10px}.comment-content hr{border:0;border-top:1px solid #eee}\n      .quoted{background:#f7f7f9;border-radius:10px;margin:10px 0 16px;border-left:3px solid #e6d0d7;padding:9px 13px;color:#85858f;font-size:12px}.quoted>summary{cursor:pointer;line-height:1.7;overflow-wrap:anywhere}.quoted-body{padding-top:10px;color:#777;line-height:1.8}.quoted .context{display:inline-block;margin-top:9px;font-size:11px;color:#b77886}.quoted .quoted{background:#eeeef2}\n      .comment-actions{display:flex;gap:15px;align-items:center;flex-wrap:wrap;margin-top:14px;font-size:11px;color:#9a9aa5}.comment-actions button{padding:4px 0;color:#aa7582}.thread{border-left:2px solid #ede5e8;margin:0 0 18px 25px;padding-left:15px}.thread>summary{font-size:12px;color:#a67986;padding:7px 0 14px;cursor:pointer}.thread .comment{padding:18px 20px}\n      .reader-bottom{text-align:center;margin:26px 0}.load-next{background:#ff2442;color:white;padding:12px 28px;border-radius:24px;font-size:13px}.reader-status{margin:13px auto;color:#999;font-size:12px;max-width:600px}.reader-status a{color:#ae7482;text-decoration:underline}.reader-footer{font-size:11px;color:#aaa;margin:14px 0}.reply-rel{font-size:11px;color:#b38390;margin-bottom:10px}\n\n      @media(max-width:600px){.reader main{padding:22px 12px}.reader h1{font-size:23px}.reader .bar{gap:10px;flex-wrap:nowrap}.reader .brand{font-size:17px}.reader .bar>.pill{font-size:11px;padding:8px 10px}.reader .top{padding:calc(10px + env(safe-area-inset-top)) 12px 10px}.reader .comment{padding:17px 16px;border-radius:14px}.reader .comment.op{padding:20px 17px}.comment-content{font-size:15px;line-height:1.85}.reader-avatar{width:29px;height:29px}.thread{margin-left:12px;padding-left:9px}.thread .comment{padding:15px 13px}.comment{scroll-margin-top:85px}}\n      .action-date{display:none}.reader-identity{min-width:0;flex:1}.attachment{display:block}\n      @media(max-width:600px){\n        .reader{background:white;padding-bottom:calc(30px + env(safe-area-inset-bottom))}.reader .top{border-bottom:1px solid #f3f3f5;padding:calc(8px + env(safe-area-inset-top)) 16px 8px}.reader .bar{gap:8px;min-width:0}.reader .brand{background:none;color:#555;font-size:15px;letter-spacing:0;padding:0;flex:1;overflow:hidden}.reader .bar>.pill{display:block;margin:0;padding:10px 8px;min-height:42px;background:none;color:#999;border-radius:0;font-size:11px}.reader main{padding:22px 18px 28px}.reader h1{font-size:21px;font-weight:700;line-height:1.6;letter-spacing:0}.reader-head{margin-bottom:20px}.reader-head .sub{font-size:11px;margin-top:8px}\n        .page-heading{margin:22px 0 5px;font-size:11px;color:#b2b2ba}.page-heading:after{background:#f3f3f5}\n        .reader .comment{position:relative;border:0;border-radius:0;background:transparent;padding:20px 0 22px 44px;margin:0;overflow:visible}.comment-head{gap:8px;align-items:flex-start;margin-bottom:6px}.reader .reader-avatar{position:absolute;left:0;top:19px;width:32px;height:32px;font-size:12px}.reader-author{font-size:13px;font-weight:500;color:#8a8a93;line-height:1.65}.floor{font-size:10px;color:#bbb;padding-top:3px}.comment-head .comment-date{display:none}.comment-content{font-size:15px;line-height:1.8;color:#333;letter-spacing:.1px}.op-label{background:#f5f5f7;color:#999;font-size:10px;padding:2px 5px;font-weight:400}\n        .reader .comment.op{padding:8px 0 23px;margin-bottom:10px;border-bottom:1px solid #eee}.comment.op .comment-head{padding-left:44px;margin-bottom:16px;min-height:36px;align-items:center}.reader .comment.op .reader-avatar{top:8px;width:34px;height:34px}.comment.op .reader-author{color:#555;font-size:14px}.comment.op .comment-content{font-size:16px;line-height:1.85}.comment.op .comment-actions{margin-top:13px}.comment-content .attachment{display:block}.comment-content .attachment img{width:auto;max-width:100%;max-height:300px;object-fit:contain;margin:12px 0;border-radius:8px}.comment.op .attachment img{max-height:none}\n        .comment-actions{gap:12px;margin-top:9px;font-size:11px;color:#aaa;line-height:1.6}.comment-actions .action-date{display:block;flex-basis:100%;font-size:11px;color:#b0b0b8}.comment-actions button{color:#999;min-height:30px;padding:3px 0}.comment-actions a{color:#aaa}.quoted{border:0;background:#f7f7f9;padding:9px 11px;border-radius:7px;margin:9px 0 12px;font-size:11px;color:#92929c}.quoted>summary{line-height:1.75}.quoted-body{font-size:12px;line-height:1.85}.quoted .context{min-height:32px;padding:4px 0;color:#8e7180}.reply-rel{font-size:11px;color:#aaa;line-height:1.7;margin:0 0 7px}\n        .thread{border:0;margin:0 0 9px 44px;padding:0}.thread>summary{list-style:none;color:#58728e;font-size:12px;font-weight:500;padding:0 0 16px;min-height:40px}.thread>summary::-webkit-details-marker{display:none}.thread>summary:before{content:'—';color:#c9d1db;margin-right:9px}.thread[open]>summary:after{content:' · 收起';font-size:11px;font-weight:400;color:#9aa8b8}.reader .thread .comment{padding:13px 0 17px 34px;margin:0}.reader .thread .reader-avatar{width:25px;height:25px;top:14px;font-size:10px}.thread .reader-author{font-size:12px}.thread .comment-content{font-size:14px}.thread .quoted{font-size:10px}.reader-bottom{margin:26px 0 12px}.load-next{background:#f7f7f9;color:#7d6b76;border-radius:20px;font-size:12px;padding:12px 25px;min-height:42px}.reader-footer{display:none}\n        .reader-status{font-size:11px;line-height:1.8}\n      }\n      @media(max-width:360px){.reader main{padding-left:14px;padding-right:14px}.reader .comment{padding-left:39px}.thread{margin-left:39px}.reader .thread .comment{padding-left:30px}}\n          /* 图片卡片：先保留画布，再淡入原图；失败时仍可重试或打开原图。 */\n      .reader-image{display:block;position:relative;width:100%;max-width:720px;margin:16px auto;overflow:hidden;border:1px solid #ececf0;border-radius:12px;background:#f5f5f7;box-shadow:0 2px 8px #22222206}\n      .reader-image .attachment{position:relative;display:block;aspect-ratio:var(--image-ratio,4 / 3);overflow:hidden;cursor:zoom-in;color:#999;text-decoration:none}\n      .reader-image .attachment img{display:block;width:100%;height:100%;max-height:none;object-fit:contain;margin:0;border-radius:0;opacity:0;transition:opacity .25s ease}\n      .reader-image.is-loaded .attachment img{opacity:1}.image-state{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:#93939d;pointer-events:none}\n      .is-loading .attachment:before{content:'';position:absolute;inset:0;background:linear-gradient(100deg,transparent 25%,#fff9 50%,transparent 75%);background-size:200% 100%;animation:image-shimmer 1.8s ease-in-out infinite}.is-loaded .image-state{display:none}\n      .image-retry{position:absolute;left:50%;top:calc(50% + 22px);transform:translateX(-50%);padding:8px 15px;border:1px solid #dedee4;border-radius:18px;background:white;font-size:12px;color:#666;min-height:36px}\n      @keyframes image-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}\n      .reader .comment.op{padding:0;background:#fff;border:1px solid #eee;border-radius:20px;overflow:hidden;margin-bottom:26px}\n      .comment.op>.comment-head{padding:22px 24px;margin:0}.note-copy{padding:0 24px 12px;min-width:0}.reader .note-title{font-size:23px;line-height:1.5;letter-spacing:0;margin:0 0 14px}.comment.op>.comment-actions{margin:0;padding:0 24px 22px}\n      .note-gallery{position:relative;min-width:0;background:#f5f5f7}.gallery-track{display:flex;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;scrollbar-width:none;aspect-ratio:4 / 5;max-height:680px}.gallery-track::-webkit-scrollbar{display:none}.gallery-slide{flex:0 0 100%;min-width:0;scroll-snap-align:start;scroll-snap-stop:always;display:flex}\n      .gallery-slide .reader-image{width:100%;max-width:none;height:100%;margin:0;border:0;border-radius:0;box-shadow:none}.gallery-slide .attachment{width:100%;height:100%;aspect-ratio:auto}.gallery-count{position:absolute;right:16px;top:16px;padding:4px 10px;border-radius:16px;background:#0006;color:white;font-size:12px;font-variant-numeric:tabular-nums;pointer-events:none}\n      .gallery-prev,.gallery-next{position:absolute;top:50%;transform:translateY(-50%);background:#ffffffdf;border-radius:50%;width:36px;height:36px;font-size:26px;line-height:1;box-shadow:0 2px 12px #0001}.gallery-prev{left:12px}.gallery-next{right:12px}.gallery-prev:disabled,.gallery-next:disabled{visibility:hidden}\n      .gallery-dots{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);display:flex;max-width:80%;overflow:auto;gap:2px;padding:2px 6px;border-radius:20px;background:#ffffffbf}.gallery-dot{flex:none;width:20px;height:20px;padding:6px}.gallery-dot:after{content:'';display:block;width:6px;height:6px;border-radius:50%;background:#c9c9cf}.gallery-dot[aria-pressed=true]:after{background:#ff2442}\n      .image-viewer{position:fixed;inset:0;width:100vw;height:100dvh;max-width:none;max-height:none;margin:0;border:0;padding:0;background:#171719;color:#fff;z-index:2147483002;overflow:hidden;color-scheme:dark}.image-viewer:not([open]){display:none}.image-viewer::backdrop{background:#000b}\n      .viewer-bar{position:absolute;z-index:2;top:0;left:0;right:0;display:flex;align-items:center;gap:20px;padding:calc(12px + env(safe-area-inset-top)) 20px 12px;background:#171719dd;font-size:13px}.viewer-count{flex:1}.viewer-close,.viewer-original{padding:10px;min-height:44px;color:#fff}.viewer-stage{display:flex;align-items:center;justify-content:center;height:100%;padding:80px 64px 40px}.viewer-stage .reader-image{max-width:100%;width:auto;max-height:100%;margin:0;border:0;background:transparent;box-shadow:none}.viewer-stage .attachment{max-height:calc(100dvh - 120px);cursor:zoom-out}.viewer-stage .attachment img{width:auto;height:auto;max-width:100%;max-height:calc(100dvh - 120px);object-fit:contain}.viewer-stage .is-loading,.viewer-stage .is-error{width:min(80vw,800px)}\n      .viewer-prev,.viewer-next{position:absolute;z-index:2;top:50%;width:44px;height:44px;border-radius:50%;background:#ffffff1a;color:#fff;font-size:30px}.viewer-prev{left:12px}.viewer-next{right:12px}\n      @media(min-width:801px){.comment.op.has-gallery{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);grid-template-rows:auto 1fr auto}.has-gallery>.note-gallery{grid-column:1;grid-row:1 / 4;align-self:start}.has-gallery>.comment-head{grid-column:2;grid-row:1}.has-gallery>.note-copy{grid-column:2;grid-row:2}.has-gallery>.comment-actions{grid-column:2;grid-row:3}.has-gallery .gallery-track{max-height:none}}\n      @media(max-width:800px){.note-gallery{margin-bottom:22px}.reader .comment.op{border-radius:16px}.gallery-track{max-height:75dvh}}\n      @media(max-width:600px){\n        .reader main{padding-top:12px}.reader .comment.op{margin:0 -18px 20px;padding:0 0 20px;border:0;border-bottom:1px solid #eee;border-radius:0;background:white}.comment.op>.comment-head{padding:10px 18px 14px 62px;min-height:58px;margin:0}.reader .comment.op .reader-avatar{left:18px;top:11px;width:34px;height:34px}.note-copy{padding:0 18px 8px}.reader .note-title{font-size:20px;line-height:1.55;margin-bottom:12px}.comment.op>.comment-actions{padding:0 18px;margin:0}.note-gallery{margin-bottom:22px}.gallery-track{max-height:70dvh}.gallery-prev,.gallery-next{width:32px;height:32px}.reader .reader-image .attachment img{width:100%;height:100%;max-height:none;margin:0;border-radius:0}.reader-image{margin:12px 0;border-radius:10px}.viewer-stage{padding:80px 12px 50px}.viewer-bar{gap:8px;padding-left:12px;padding-right:12px}.viewer-original{font-size:12px}.viewer-prev,.viewer-next{top:auto;bottom:calc(12px + env(safe-area-inset-bottom));width:40px;height:40px}\n      }\n      @media(max-width:360px){.reader .comment.op{margin-left:-14px;margin-right:-14px}}\n      @media(prefers-reduced-motion:reduce){.is-loading .attachment:before{animation:none}.reader-image .attachment img{transition:none}}\n      .comment:not(.op) .reader-image .attachment{max-height:360px}.comment-content p:empty{display:none}\n      @media(max-width:600px){.comment:not(.op) .reader-image .attachment{max-height:300px}}\n      .reader.rt-dark .comment.op{background:#202329;border-color:#34373e}.reader.rt-dark .note-gallery,.reader.rt-dark .reader-image{background:#2c3038;border-color:#34373e}.reader.rt-dark .comment.op .reader-author{color:#ddd}.reader.rt-paper .comment.op{background:#faf7ef;border-color:#eee2cf}.reader.rt-paper .note-gallery,.reader.rt-paper .reader-image{background:#f0ece4}.reader .note-title{font-size:calc(23px * var(--rt-scale,1))}\n      @media(max-width:600px){.reader .note-title{font-size:calc(20px * var(--rt-scale,1))}}\n      .reader-end{display:flex;align-items:center;justify-content:center;gap:14px;max-width:280px;margin:24px auto;color:#96939c;font-size:13px}.reader-end:before,.reader-end:after{content:'';height:1px;flex:1;background:currentColor;opacity:.2}\n      @media(max-width:600px){.reader .comment-actions button,.reader .comment-actions a,.reader .load-next{min-height:48px}.reader .comment-actions{gap:4px 8px}.reader .comment-actions button,.reader .comment-actions a{display:inline-flex;align-items:center;padding:8px 10px;border-radius:24px}.reader .comment-actions button:active,.reader .comment-actions a:active:active{background:#e8e1e8}.reader .load-next{min-width:160px;border-radius:24px;background:#f5e4ea;color:#8c3650;font-weight:600}}\n\n      /* 短回复随内容收缩，原站入口集中在右上角楼层号。 */\n      .comment-actions{margin-top:6px}\n      .reader .floor{display:inline-flex;align-items:center;justify-content:flex-end;min-width:36px;min-height:32px;padding:0 2px}\n      @media(max-width:600px){\n        .reader .comment:not(.op){padding-top:12px;padding-bottom:12px}\n        .reader .comment:not(.op) .reader-avatar{top:12px}\n        .reader .comment-head{margin-bottom:3px;align-items:center;min-height:28px}\n        .reader .comment-actions{margin-top:4px}\n        .reader .comment-content{line-height:1.7}\n        .reader .comment-content p{margin:6px 0}\n        .reader .comment-content>p:first-child{margin-top:0}\n        .reader .comment-content>p:last-child{margin-bottom:0}\n      }\n");
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
      if (typeof isDeletedDoc === 'function' && isDeletedDoc(document)) { navigation.finish(); return; }
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
  startList(); configureListRefresh();
  // 列表由 NGA 后续脚本生成时再扫描，不覆盖登录/错误页。
  const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 220); });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  observeListEnd();
  window.addEventListener('pagehide', () => { observer.disconnect(); cardObserver?.disconnect(); listObserver?.disconnect(); listController?.abort(); refreshController?.abort(); stopListRefresh(); clearTimeout(timer); clearTimeout(gateTimer); });
}

const config = {"storageKey":"nga-cards-v1","hosts":["bbs.nga.cn","nga.178.com","ngabbs.com","bbs.ngacn.cc"],"paths":["/thread.php","/read.php","/forum.php","/index.php","/"]};
config.accepts = u => config.hosts.includes(u.hostname) && config.paths.includes(u.pathname);
const postCache = createPostCache({ context: window, key: config.storageKey });
config.mountReader = context => { const navigation = createNavigation(config, context); try { runAdapter({ navigation, context, postCache }); } catch (error) { navigation.destroy(); throw error; } return () => { context.dispatchEvent(new context.PageTransitionEvent('pagehide')); navigation.destroy(); }; };
const navigation = createNavigation(config);
const start = () => { if (!config.accepts(new URL(location.href))) { navigation.finish(); return; } try { runAdapter({ navigation, postCache }); } catch (error) { navigation.finish(); console.error('[readscape]', error); } };
if (document.body && document.head) start();
else document.addEventListener('DOMContentLoaded', start, {once:true});
})();
