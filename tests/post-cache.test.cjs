const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const {IDBFactory,IDBObjectStore}=require('fake-indexeddb');
const fs=require('node:fs');
const source=fs.readFileSync(__dirname+'/../src/core/post-cache.js','utf8');
const bundle=fs.readFileSync(__dirname+'/../dist/readscape-nga.user.js','utf8');
const sessions=[];afterEach(()=>{for(const {w,cache} of sessions.splice(0)){cache?.close();w.close();}});
const png=new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')],{type:'image/png'});
function setup(options={}){
 const d=new JSDOM('<body></body>',{url:'https://bbs.nga.cn/thread.php?fid=1',runScripts:'dangerously',virtualConsole:new VirtualConsole()}),w=d.window;
 w.indexedDB=options.disabledStorage ? undefined : options.factory||new IDBFactory();w.Blob=Blob;w.eval(source+';window.createPostCache=createPostCache;');
 const cache=w.createPostCache({context:w,key:'test',loadImage:async()=>png,...options});sessions.push({w,cache});return {w,cache};
}
async function records(factory,store='posts',name='test-posts'){
 if(store==='images')store='resources';
 return new Promise((resolve,reject)=>{const open=factory.open(name);open.onsuccess=()=>{const db=open.result,tx=db.transaction(store),request=tx.objectStore(store).getAll();tx.oncomplete=()=>{db.close();resolve(request.result);};};open.onerror=()=>reject(open.error);});
}
test('stores actual image bytes and reuses them across readers without another download',async()=>{
 const factory=new IDBFactory();let calls=0;
 const one=setup({factory,loadImage:async()=>{calls++;return png;}});
 assert(await one.cache.saveCover('1','https://img.nga.cn/one.png',{title:'帖子一'}));
 const stored=await one.cache.getCover('1');assert.equal(stored.blob.size,png.size);assert.equal(await stored.blob.text(),await png.text());
 const two=setup({factory,loadImage:async()=>{calls++;throw new Error('离线');}});
 assert(await two.cache.getCover('1'));assert(await two.cache.saveCover('1','https://img.nga.cn/one.png'));assert.equal(calls,1);
});
test('post and image expire together seven days after their last visit, and reads do not extend the lifetime',async()=>{
 const {w,cache}=setup();let now=100000;w.Date.now=()=>now;
 await cache.saveCover('1','https://img.nga.cn/one.png');await cache.saveCover('2','https://img.nga.cn/two.png');
 now+=6*86400000;await cache.visit({tid:'1'});assert(await cache.getCover('2'));
 now+=2*86400000;assert.equal(await cache.getCover('2'),null);await cache.cleanup();
 assert(await cache.getCover('1'));assert.deepEqual((await records(w.indexedDB)).map(p=>p.tid),['1']);assert.deepEqual((await records(w.indexedDB,'images')).map(p=>p.id),['https://img.nga.cn/one.png']);
 now+=8*86400000;await cache.visit({tid:'1'});assert.equal(await cache.getCover('1'),null,'an expired cover cannot be revived by visiting before cleanup');assert.equal((await records(w.indexedDB,'images')).length,0);
});
test('image-byte and post-count limits evict matching metadata and images while recent posts survive',async()=>{
 const {w,cache}=setup({maxPosts:2,maxImageBytes:png.size*2});let now=1;w.Date.now=()=>now;
 const evicted=[];cache.subscribe(event=>{if(event.type==='evict')evicted.push(...event.tids);});
 await cache.saveCover('1','https://img.nga.cn/1.png');now++;await cache.saveCover('2','https://img.nga.cn/2.png');now++;
 await cache.saveCover('3','https://img.nga.cn/3.png');assert.equal(await cache.getCover('1'),null);assert(await cache.getCover('3'));assert(evicted.includes('1'));
 assert((await records(w.indexedDB)).length<=2);assert((await records(w.indexedDB,'images')).reduce((sum,p)=>sum+p.blob.size,0)<=png.size*2);
 await cache.remove(['3']);assert.equal(await cache.getCover('3'),null);assert(!(await records(w.indexedDB)).some(p=>p.tid==='3'));
 const bytes=setup({maxImageBytes:png.size});await bytes.cache.saveCover('1','https://img.nga.cn/1.png');await bytes.cache.saveCover('2','https://img.nga.cn/2.png');
 assert.equal((await records(bytes.w.indexedDB)).length,1);assert.equal((await records(bytes.w.indexedDB,'images')).length,1);
});
test('failed downloads, oversized images and unsupported storage leave the reader usable',async()=>{
 const small=setup({maxImageBytes:1});assert.equal(await small.cache.saveCover('1','https://img.nga.cn/one.png'),false);
 const failing=setup({loadImage:async()=>{throw new Error('CORS');}});assert.equal(await failing.cache.saveCover('1','https://img.nga.cn/one.png'),false);
 const bad=setup({loadImage:async()=>new Blob(['<html>登录</html>'],{type:'text/html'})});assert.equal(await bad.cache.saveCover('1','https://img.nga.cn/one.png'),false);
 const missing=setup({disabledStorage:true});assert.equal(await missing.cache.saveCover('1','https://img.nga.cn/one.png'),false);
});
test('quota errors release an older post and retry the atomic image write',async()=>{
 const {w,cache}=setup();await cache.saveCover('1','https://img.nga.cn/one.png');
 const put=IDBObjectStore.prototype.put;let refused=false;
 IDBObjectStore.prototype.put=function(value,...rest){if(this.name==='resources'&&value.id==='https://img.nga.cn/two.png'&&!refused){refused=true;throw new DOMException('Quota','QuotaExceededError');}return put.call(this,value,...rest);};
 try{assert(await cache.saveCover('2','https://img.nga.cn/two.png'));assert.equal(await cache.getCover('1'),null);assert(await cache.getCover('2'));assert.equal((await records(w.indexedDB)).length,1);}finally{IDBObjectStore.prototype.put=put;}
});
test('NGA attachments use the userscript binary download API when available',async()=>{
 const {w,cache}=setup({loadImage:undefined});let options;
 w.GM_xmlhttpRequest=input=>{options=input;queueMicrotask(()=>input.onload({status:200,response:png}));};
 w.fetch=()=>{throw new Error('should use the granted image request');};
 assert(await cache.saveCover('1','https://img4.nga.cn/attachments/one.png'));assert.equal(options.responseType,'blob');assert.equal(options.timeout,15000);
});
test('the reader caches the first OP attachment even in a collapsed block, excluding emoticons and quotes; a later list uses the blob',async()=>{
 const factory=new IDBFactory(),image='https://img.nga.cn/attachments/first.png';const requested=[];
 const body='<img src="https://img4.nga.cn/ngabbs/post/smile/ac15.png"><div class="quote"><img src="https://img.nga.cn/quoted.png"></div><details><summary>贴图</summary><img src="'+image+'"></details><img src="https://img.nga.cn/second.png">';
 const post=`<table><tr><td><a>#0</a><a id="postauthor0">楼主</a></td><td id="postcontainer0"><a id="pid1Anchor"></a><div id="postcontent0" class="postcontent">${body}</div></td></tr></table>`;
 const d=new JSDOM('<head></head><body>'+post+'</body>',{url:'https://bbs.nga.cn/read.php?tid=47653422',runScripts:'dangerously',virtualConsole:new VirtualConsole()}),w=d.window;
 sessions.push({w});w.indexedDB=factory;w.fetch=async url=>{requested.push(url);return {ok:true,blob:async()=>png};};w.eval(bundle);
 await new Promise(resolve=>setTimeout(resolve,10));
 for(let i=0;i<100;i++){const cached=await records(factory,'images','nga-cards-v1-posts');if(cached.length)break;await new Promise(resolve=>setTimeout(resolve,5));}
 assert.equal(requested.filter(url=>url===image).length,1);assert(!requested.some(url=>url.includes('smile')));const cached=await records(factory,'images','nga-cards-v1-posts');assert(cached.some(row=>row.source===image));
 const list=new JSDOM('<head></head><body><table><tr><td class="c2"><a class="topic" href="/read.php?tid=47653422">首图帖子</a></td></tr></table></body>',{url:'https://bbs.nga.cn/thread.php?fid=1',runScripts:'dangerously',virtualConsole:new VirtualConsole()});
 const lw=list.window;sessions.push({w:lw});lw.indexedDB=factory;lw.URL.createObjectURL=()=> 'blob:cached-cover';lw.URL.revokeObjectURL=()=>{};
 const src=Object.getOwnPropertyDescriptor(lw.HTMLImageElement.prototype,'src');lw.Object.defineProperty(lw.HTMLImageElement.prototype,'src',{get:src.get,set(value){src.set.call(this,value);queueMicrotask(()=>this.dispatchEvent(new lw.Event('load')));}});
 lw.fetch=()=>{throw new Error('cached list must not request the image or thread');};lw.eval(bundle);
 const root=lw.document.querySelector('#nga-cards-host').shadowRoot,card=root.querySelector('.card'),cover=card.querySelector('.cover');
 for(let i=0;i<100&&!cover.classList.contains('cached-cover');i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert(cover.classList.contains('cached-cover'));assert.equal(root.querySelector('.card'),card);assert.equal(cover.querySelector('img').src,'blob:cached-cover');
 assert.equal(lw.getComputedStyle(cover.querySelector('img')).position,'absolute','the image does not change the existing card height');
});
