const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const {IDBFactory}=require('fake-indexeddb');
const fs=require('node:fs');
const source=fs.readFileSync(__dirname+'/../src/core/post-cache.js','utf8');
const bundle=fs.readFileSync(__dirname+'/../dist/readscape-nga.user.js','utf8');
const sessions=[];afterEach(()=>{for(const {w,cache} of sessions.splice(0)){cache?.close();w.close();}});
function setup(options={}){
 const d=new JSDOM('<body></body>',{url:'https://bbs.nga.cn/thread.php?fid=1',runScripts:'dangerously',virtualConsole:new VirtualConsole()}),w=d.window;
 w.indexedDB=options.disabledStorage ? undefined : options.factory||new IDBFactory();w.eval(source+';window.createPostCache=createPostCache;');
 const cache=w.createPostCache({context:w,key:'test',...options});sessions.push({w,cache});return {w,cache};
}
async function records(factory,store='posts',name='test-posts'){
 return new Promise((resolve,reject)=>{const open=factory.open(name);open.onsuccess=()=>{const db=open.result,tx=db.transaction(store),request=tx.objectStore(store).getAll();tx.oncomplete=()=>{db.close();resolve(request.result);};};open.onerror=()=>reject(open.error);});
}
test('cover URLs are recorded without downloading bytes and reused across sessions',async()=>{
 const factory=new IDBFactory();
 const one=setup({factory});
 assert(await one.cache.saveCover('1','https://img.nga.cn/one.png',{title:'帖子一',coverW:640,coverH:1407}));
 const coverInfo=await one.cache.getCover('1');
 assert.equal(coverInfo.source,'https://img.nga.cn/one.png');
 assert.equal(coverInfo.width,640);assert.equal(coverInfo.height,1407,'封面比例随封面一起返回，供列表预占位');
 assert.equal((await one.cache.getPost('1')).title,'帖子一');
 await one.cache.saveCover('1','https://img.nga.cn/one.png#ignored');
 assert.equal((await one.cache.getCover('1')).source,'https://img.nga.cn/one.png','片段地址按同一资源处理');
 assert.equal(await one.cache.saveCover('2','data:image/png;base64,AAAA'),false,'非 HTTP 图片地址不记录');
 assert.equal(await one.cache.saveCover('bad','https://img.nga.cn/x.png'),false,'非数字帖子标识不记录');
 const two=setup({factory});
 assert.equal((await two.cache.getCover('1')).source,'https://img.nga.cn/one.png');
});
test('a cover registered right before an unload is recovered from the pending log on next load',async()=>{
 const {w}=setup();
 const first=w.createPostCache({context:w,key:'test'});sessions.push({w,cache:first});
 const pending=first.saveCover('1','https://img.nga.cn/one.png',{title:'帖子一'});
 first.close(); // 模拟页面在 IndexedDB 写入提交前被刷新或关闭
 assert.equal(await pending,false,'未提交的写入不会谎报成功');
 assert(w.localStorage.getItem('test-cover-pending'),'同步 pending 日志已写入');
 const second=w.createPostCache({context:w,key:'test'});sessions.push({w,cache:second});
 assert.equal((await second.getCover('1')).source,'https://img.nga.cn/one.png','pending 日志在下次加载时回填封面');
 assert.equal(w.localStorage.getItem('test-cover-pending'),null,'回填后清理 pending 日志');
});
test('posts and covers expire seven days after their last visit, and reads do not extend the lifetime',async()=>{
 const {w,cache}=setup();let now=100000;w.Date.now=()=>now;
 await cache.saveCover('1','https://img.nga.cn/one.png');await cache.saveCover('2','https://img.nga.cn/two.png');
 now+=6*86400000;await cache.visit({tid:'1'});assert(await cache.getCover('2'));
 now+=2*86400000;assert.equal(await cache.getCover('2'),null);await cache.cleanup();
 assert(await cache.getCover('1'));assert.deepEqual((await records(w.indexedDB)).map(p=>p.tid),['1']);
 assert.equal((await records(w.indexedDB)).find(p=>p.tid==='1').coverId,'https://img.nga.cn/one.png');
 now+=8*86400000;await cache.visit({tid:'1'});assert.equal(await cache.getCover('1'),null,'an expired cover cannot be revived by visiting before cleanup');
});
test('post-count limits evict the oldest posts while recent ones survive',async()=>{
 const {w,cache}=setup({maxPosts:2});let now=1;w.Date.now=()=>now;
 const evicted=[];cache.subscribe(event=>{if(event.type==='evict')evicted.push(...event.tids);});
 await cache.saveCover('1','https://img.nga.cn/1.png');now++;await cache.saveCover('2','https://img.nga.cn/2.png');now++;
 await cache.saveCover('3','https://img.nga.cn/3.png');assert.equal(await cache.getCover('1'),null);assert(await cache.getCover('3'));assert(evicted.includes('1'));
 assert((await records(w.indexedDB)).length<=2);
 await cache.remove(['3']);assert.equal(await cache.getCover('3'),null);assert(!(await records(w.indexedDB)).some(p=>p.tid==='3'));
});
test('metadata budget evicts the least recently used post first',async()=>{
 const {w,cache}=setup({maxMetadataBytes:400});let now=1;w.Date.now=()=>now;
 await cache.saveCover('1','https://img.nga.cn/one.png',{title:'标题一'.repeat(8)});now++;
 await cache.saveCover('2','https://img.nga.cn/two.png',{title:'标题二'.repeat(8)});
 const rows=await records(w.indexedDB);
 assert(rows.length<2,'文字预算不足时淘汰较早的帖子');
 assert(!rows.some(p=>p.tid==='1'));
});
test('unsupported storage or a disabled cache leave the reader usable',async()=>{
 const missing=setup({disabledStorage:true});assert.equal(await missing.cache.saveCover('1','https://img.nga.cn/one.png'),false);assert.equal(await missing.cache.stats().then(s=>s.available),false);
 const {cache}=setup();await cache.saveCover('2','https://img.nga.cn/two.png');await cache.configure({enabled:false});assert.equal(await cache.saveCover('3','https://img.nga.cn/three.png'),false);assert.equal(await cache.visit({tid:'4'}),null);
});
test('the reader records the first OP attachment as a cover URL, excluding emoticons and quotes, and the list renders it directly',async()=>{
 const factory=new IDBFactory(),image='https://img.nga.cn/attachments/first.png';
 const body='<img src="https://img4.nga.cn/ngabbs/post/smile/ac15.png"><div class="quote"><img src="https://img.nga.cn/quoted.png"></div><details><summary>贴图</summary><img src="'+image+'" data-nw="640" data-nh="1407"></details><img src="https://img.nga.cn/second.png">';
 const post=`<table><tr><td><a>#0</a><a id="postauthor0">楼主</a></td><td id="postcontainer0"><a id="pid1Anchor"></a><div id="postcontent0" class="postcontent">${body}</div></td></tr></table>`;
 const d=new JSDOM('<head></head><body>'+post+'</body>',{url:'https://bbs.nga.cn/read.php?tid=47653422',runScripts:'dangerously',virtualConsole:new VirtualConsole()}),w=d.window;
 sessions.push({w});w.indexedDB=factory;w.fetch=()=>{throw new Error('reader must not download image bytes');};w.eval(bundle);
 for(let i=0;i<100;i++){const rows=await records(factory,'posts','nga-cards-v1-posts');if(rows.some(r=>r.coverId))break;await new Promise(resolve=>setTimeout(resolve,5));}
 const stored=await records(factory,'posts','nga-cards-v1-posts');assert.equal(stored.find(r=>r.tid==='47653422').coverId,image);
 assert.equal(stored.find(r=>r.tid==='47653422').coverW,640,'阅读器把封面自然宽高记入帖子，供列表预占位');
 const list=new JSDOM('<head></head><body><table><tr><td class="c2"><a class="topic" href="/read.php?tid=47653422">首图帖子</a></td></tr></table></body>',{url:'https://bbs.nga.cn/thread.php?fid=1',runScripts:'dangerously',virtualConsole:new VirtualConsole()});
 const lw=list.window;sessions.push({w:lw});lw.indexedDB=factory;
 const src=Object.getOwnPropertyDescriptor(lw.HTMLImageElement.prototype,'src');lw.Object.defineProperty(lw.HTMLImageElement.prototype,'src',{get:src.get,set(value){src.set.call(this,value);queueMicrotask(()=>this.dispatchEvent(new lw.Event('load')));}});
 lw.fetch=()=>{throw new Error('cached list must not request the thread');};lw.eval(bundle);
 const root=lw.document.querySelector('#nga-cards-host').shadowRoot;
 for(let i=0;i<100&&!root.querySelector('.card');i++)await new Promise(resolve=>setTimeout(resolve,5));
 const card=root.querySelector('.card'),cover=card.querySelector('.cover');
 for(let i=0;i<100&&!cover.classList.contains('cached-cover');i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert(cover.classList.contains('cached-cover'));assert.equal(root.querySelector('.card'),card);assert.equal(cover.querySelector('img').src,image,'列表直接引用原图地址');
 assert.equal(cover.querySelector('img').style.aspectRatio,'640 / 1407','列表在图片加载前按存储比例占位，滚动时高度不跳');
 assert.equal(cover.firstElementChild,cover.querySelector('img'),'封面图在最上，文字在其下方');
 assert.equal(lw.getComputedStyle(cover.querySelector('img')).position,'static','封面图按自身比例排布，不再绝对定位覆盖文字');
});