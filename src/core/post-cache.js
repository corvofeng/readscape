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