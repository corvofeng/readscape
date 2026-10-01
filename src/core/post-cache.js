function createPostCache({ context = globalThis.window, key, maxPosts = 500, maxMetadataBytes = 10 * 1024 * 1024, maxImageBytes = 500 * 1024 * 1024, ttl = 7 * 86400000, loadImage }) {
  const stores = ['posts', 'replyPages', 'resources', 'relations', 'listPages'];
  const listeners = new Set(), pending = new Map(), jobs = [];
  let connection, queue = Promise.resolve(), closed = false, epoch = 0, downloads = 0;
  let enabled = true, postLimit = maxPosts, imageLimit = maxImageBytes;
  const channel = typeof context.BroadcastChannel === 'function' ? new context.BroadcastChannel(`${key}-cache-events`) : null;
  const validTid = tid => /^\d+$/.test(String(tid));
  const size = value => JSON.stringify(value).length * 2;
  const resourceId = source => { try { const u = new URL(source); if (!/^https?:$/.test(u.protocol)) return null; u.hash = ''; return u.href; } catch { return null; } };
  const notify = event => { for (const listener of listeners) { try { listener(event); } catch {} } if (!event.remote) { try { channel?.postMessage(event); } catch {} } };
  if (channel) channel.onmessage = message => { const event=message.data;if(!event||!['clear','usage','favorites','evict','cover','image'].includes(event.type))return;if(event.type==='clear')epoch++;notify({...event,remote:true}); };
  function database() {
    return connection ||= new Promise(resolve => {
      if (!context.indexedDB || closed) { resolve(null); return; }
      try {
        const request = context.indexedDB.open(`${key}-posts`, 2);
        request.onupgradeneeded = () => {
          const db = request.result, tx = request.transaction;
          for (const [name, keyPath] of [['posts','tid'],['replyPages',['tid','page']],['resources','id'],['relations','id'],['listPages','id']]) {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
          }
          for (const [name, indexes] of [['posts',['lastAccess']],['replyPages',['tid']],['resources',['lastAccess']],['relations',['tid','resourceId','kind']],['listPages',['streamKey']]]) {
            const store = tx.objectStore(name);
            for (const index of indexes) if (!store.indexNames.contains(index)) store.createIndex(index, index);
          }
          // Version 1 keyed each cover by thread. Version 2 shares a resource
          // by URL and links it to its owner; cursor migration never reads all blobs.
          if (db.objectStoreNames.contains('images')) {
            const cursor = tx.objectStore('images').openCursor();
            cursor.onsuccess = () => {
              const row = cursor.result;
              if (!row) { db.deleteObjectStore('images'); return; }
              const image = row.value, id = resourceId(image.source);
              if (id && image.blob) {
                const post = tx.objectStore('posts').get(image.tid);
                post.onsuccess = () => {
                  if (!post.result) return;
                  const p = { ...post.result, coverId: id }; delete p.source; delete p.bytes;
                  tx.objectStore('posts').put(p);
                  tx.objectStore('resources').put({ id, source: id, blob: image.blob, bytes: image.blob.size, mime: image.blob.type, lastAccess: p.lastAccess });
                  tx.objectStore('relations').put({ id: `cover:${p.tid}`, kind: 'image', role: 'cover', tid: p.tid, resourceId: id });
                };
              }
              row.continue();
            };
          }
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
    for (const name of stores) {
      if (name !== 'resources') {
        const request = tx.objectStore(name).getAll(); request.onsuccess = () => finish(name, request.result);
      } else {
        const rows = [], request = tx.objectStore(name).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) { finish(name, rows); return; }
          const { blob, ...metadata } = cursor.value; rows.push(metadata); cursor.continue();
        };
      }
    }
  }
  function removePost(model, tid) {
    model.posts.delete(tid);
    for (const [id, row] of model.replyPages) if (row.tid === tid) model.replyPages.delete(id);
    for (const [id, row] of model.relations) if (row.tid === tid && row.kind !== 'favorite') model.relations.delete(id);
    for (const [id, row] of model.listPages) {
      row.tids = row.tids.filter(t => t !== tid); if (!row.tids.length) model.listPages.delete(id);
    }
  }
  function orphanImages(model) {
    const retained = new Set([...model.relations.values()].filter(r => r.kind === 'image').map(r => r.resourceId));
    for (const id of model.resources.keys()) if (!retained.has(id)) model.resources.delete(id);
  }
  function usage(model, sizes = new WeakMap()) {
    const bytes = row => { if (!sizes.has(row)) sizes.set(row,size(row)); return sizes.get(row); };
    const metadataBytes = ['posts','replyPages'].reduce((sum, name) => sum + [...model[name].values()].reduce((n, row) => n + bytes(row), 0), 0) + [...model.listPages.values()].reduce((n,row)=>n+size(row),0) +
      [...model.relations.values()].filter(r => r.kind !== 'favorite').reduce((n, row) => n + bytes(row), 0) + [...model.resources.values()].reduce((n, row) => n + bytes(row), 0);
    const imageBytes = [...model.resources.values()].reduce((n, row) => n + row.bytes, 0);
    return { available: true, posts: model.posts.size, replyPages: model.replyPages.size, images: model.resources.size, metadataBytes, imageBytes, totalBytes: metadataBytes + imageBytes, favorites: [...model.relations.values()].filter(r => r.kind === 'favorite').length, enabled, maxPosts: postLimit, maxMetadataBytes, maxImageBytes: imageLimit };
  }
  function prune(model) {
    const now = Date.now();
    for (const p of model.posts.values()) if (now - p.lastAccess > ttl) removePost(model, p.tid);
    orphanImages(model);
    const sizes = new WeakMap();
    for (const p of [...model.posts.values()].sort((a,b) => a.lastAccess - b.lastAccess)) {
      const used = usage(model,sizes);
      if (used.posts <= postLimit && used.metadataBytes <= maxMetadataBytes && used.imageBytes <= imageLimit) break;
      removePost(model, p.tid); orphanImages(model);
    }
  }
  async function mutate(change, generation = epoch) {
    const db = await database(); if (!db || closed || generation !== epoch) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite'); let result, removed = [], changed = false;
      readModel(tx, (model, original) => {
        try {
          const writes = new Map(); result = change(model, writes); prune(model);
          removed = [...original.posts.keys()].filter(tid => !model.posts.has(tid));
          for (const name of stores) {
            const store = tx.objectStore(name);
            for (const [id, row] of original[name]) if (!model[name].has(id)) { store.delete(name === 'replyPages' ? [row.tid,row.page] : id); changed = true; }
            for (const [id, row] of model[name]) {
              if (name === 'resources' && writes.has(id)) { store.put({ ...row, blob: writes.get(id) }); changed = true; }
              else if (JSON.stringify(row) !== JSON.stringify(original[name].get(id))) {
                changed = true;
                if (name === 'resources') {
                  const get = store.get(id); get.onsuccess = () => { if (get.result) store.put({ ...get.result, ...row }); };
                } else store.put(row);
              }
            }
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
    for (const r of model.relations.values()) if (r.tid === tid && r.kind === 'image') {
      const image = model.resources.get(r.resourceId); if (image) image.lastAccess = at;
    }
  }
  const ready = database().then(async db => {
    if (!db) return false;
    let pages = [], favorites = {};
    try { const raw = context.localStorage.getItem(`${key}-list-cache`); if (raw && raw.length * 2 <= maxMetadataBytes) pages = JSON.parse(raw)?.pages || []; } catch {}
    try { favorites = JSON.parse(context.localStorage.getItem(`${key}-favorites`) || '{}'); } catch {}
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
      return true;
    });
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
  async function getImage(tid, source) {
    const id = resourceId(source);if(!id||!await getPost(tid))return null;
    const db = await database(); return new Promise(resolve => {
      const tx=db.transaction(['resources','relations']), request=tx.objectStore('resources').get(id),links=tx.objectStore('relations').index('tid').getAll(String(tid));
      tx.oncomplete=()=>resolve(request.result&&links.result.some(r=>r.resourceId===id) ? {source:request.result.source,blob:request.result.blob} : null); tx.onerror=tx.onabort=()=>resolve(null);
    });
  }
  async function getCover(tid) { const post=await getPost(tid); return post?.coverId ? getImage(tid,post.coverId) : null; }
  async function download(source) {
    if (loadImage) return loadImage(source);
    const url=new URL(source);
    if(typeof GM_xmlhttpRequest==='function' && /^(?:img\d*\.nga\.cn|img\.nga\.178\.com)$/.test(url.hostname)) return new Promise((resolve,reject)=>GM_xmlhttpRequest({method:'GET',url:source,responseType:'blob',timeout:15000,onload:r=>r.status>=200&&r.status<300?resolve(r.response):reject(new Error('图片下载失败')),onerror:reject,ontimeout:reject,onabort:reject}));
    const controller=new context.AbortController(),timeout=context.setTimeout(()=>controller.abort(),15000);
    try { const response=await context.fetch(source,{credentials:'omit',signal:controller.signal}); if(!response.ok)throw new Error('图片下载失败'); return await response.blob(); } finally {context.clearTimeout(timeout);}
  }
  function pump() {
    while(downloads<3&&jobs.length){const job=jobs.shift();downloads++;Promise.resolve().then(job.task).then(job.resolve,job.reject).finally(()=>{downloads--;pump();});}
  }
  function fetchBlob(id) {
    if(pending.has(id))return pending.get(id);
    const task=new Promise((resolve,reject)=>{jobs.push({task:()=>download(id),resolve,reject});pump();}).finally(()=>pending.delete(id));pending.set(id,task);return task;
  }
  async function saveImage(tid, source, { role='attachment', page=0, commentKey='', metadata={} }={}) {
    tid=String(tid);const id=resourceId(source),generation=epoch;
    if(!id||!validTid(tid)||!enabled||imageLimit<=0)return false;
    if(!await ready||!await database()||generation!==epoch)return false;
    const relationId=role==='cover'?`cover:${tid}`:`image:${tid}:${page}:${commentKey}:${id}`;
    await write(model=>{remember(model,{...metadata,tid});model.relations.set(relationId,{id:relationId,kind:'image',role,tid,page,commentKey,resourceId:id});if(role==='cover')model.posts.get(tid).coverId=id;});
    if(await getImage(tid,id)){if(role==='cover')notify({type:'cover',tid,source:id});return true;}
    let blob;try{blob=await fetchBlob(id);}catch{return false;}
    if(generation!==epoch||!enabled||!blob||!/^image\/(?:jpeg|png|gif|webp|avif|bmp)(?:;|$)/i.test(blob.type)||!blob.size||blob.size>imageLimit)return false;
    const commit=()=>mutate((model,writes)=>{if(!model.posts.has(tid))return false;model.resources.set(id,{id,source:id,bytes:blob.size,mime:blob.type,lastAccess:Date.now()});writes.set(id,blob);return true;},generation);
    let stored=await enqueue(commit);
    while(!stored&&generation===epoch){
      const released=await enqueue(()=>mutate(model=>{const oldest=[...model.posts.values()].filter(p=>p.tid!==tid&&[...model.relations.values()].some(r=>r.tid===p.tid&&model.resources.has(r.resourceId))).sort((a,b)=>a.lastAccess-b.lastAccess)[0];if(oldest)removePost(model,oldest.tid);return !!oldest;},generation));
      if(!released)break;stored=await enqueue(commit);
    }
    if(stored&&await getImage(tid,id)){notify({type:role==='cover'?'cover':'image',tid,source:id});return true;}return false;
  }
  const saveCover=(tid,source,metadata={})=>saveImage(tid,source,{role:'cover',metadata});
  const cleanup=()=>enqueue(async()=>{if(!await ready)return null;return mutate(()=>true);});
  const remove=tids=>write(model=>{for(const tid of tids)removePost(model,String(tid));return true;});
  async function stats(){const used=await read(usage,true);return used||{available:false,enabled,maxPosts:postLimit,maxImageBytes:imageLimit};}
  function configure(options={}) {
    const changed=enabled!==(options.enabled!==false);enabled=options.enabled!==false;
    postLimit=Math.max(1,Math.min(maxPosts,Math.trunc(Number(options.maxPosts)||maxPosts)));
    const requested=Number(options.imageMB ?? maxImageBytes/1048576);imageLimit=Math.max(0,Math.min(maxImageBytes,(Number.isFinite(requested)?requested:maxImageBytes/1048576)*1048576));
    if(changed)epoch++;return cleanup();
  }
  function clear() {
    epoch++;const generation=epoch;
    return enqueue(async()=>{if(!await ready)return null;const result=await mutate(model=>{for(const name of ['posts','replyPages','resources','listPages'])model[name].clear();for(const [id,r]of model.relations)if(r.kind!=='favorite')model.relations.delete(id);return true;},generation);if(result)notify({type:'clear'});return result;});
  }
  function scheduleCleanup(){if(context.requestIdleCallback)context.requestIdleCallback(()=>cleanup(),{timeout:5000});else context.setTimeout(()=>cleanup(),1000);}
  scheduleCleanup();const timer=context.setInterval(scheduleCleanup,30*60000);
  const close=()=>{closed=true;context.clearInterval(timer);connection?.then(db=>db?.close());listeners.clear();channel?.close();};context.addEventListener('pagehide',e=>{if(!e.persisted)close();});
  return {ready,visit,getPost,getReplyPage,saveReplyPage,getListPages,saveListPages,getFavorites,setFavorite,getImage,saveImage,getCover,saveCover,cleanup,remove,stats,configure,clear,get generation(){return epoch;},subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},close};
}
