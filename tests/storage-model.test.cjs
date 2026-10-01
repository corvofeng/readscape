const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const {IDBFactory}=require('fake-indexeddb');
const fs=require('node:fs');
const core=fs.readFileSync(__dirname+'/../src/core/post-cache.js','utf8');
const settings=fs.readFileSync(__dirname+'/../src/core/settings.js','utf8');
const bundle=fs.readFileSync(__dirname+'/../dist/readscape-nga.user.js','utf8');
const png=new Blob(['png bytes'],{type:'image/png'}),sessions=[];
afterEach(()=>{for(const {w,cache}of sessions.splice(0)){cache?.close();w.close();}});
function setup(options={},legacy={}){
 const d=new JSDOM('<head></head><body></body>',{url:'https://bbs.nga.cn/read.php?tid=1',runScripts:'dangerously',virtualConsole:new VirtualConsole()}),w=d.window;
 w.indexedDB=options.factory||new IDBFactory();for(const [key,value]of Object.entries(legacy))w.localStorage.setItem(key,JSON.stringify(value));
 w.eval(core+';window.createPostCache=createPostCache;');const cache=w.createPostCache({context:w,key:'test',loadImage:async()=>png,...options});sessions.push({w,cache});return {w,cache};
}
const waitFor=async condition=>{for(let i=0;i<200;i++){if(await condition())return;await new Promise(r=>setTimeout(r,10));}assert.fail('timed out');};
test('reply pages store structured snapshots and the OP body separately; shared images are counted once',async()=>{
 let downloads=0;const {cache}=setup({loadImage:async()=>{downloads++;return png;}});
 const replies=[{key:'pid:1',floor:0,author:'楼主',html:'<div class="postcontent">正文</div>'}];
 await cache.saveReplyPage('1',1,replies,{next:true,title:'标题',url:'https://bbs.nga.cn/read.php?tid=1'});
 assert.equal((await cache.getPost('1')).contentHtml,replies[0].html);assert.equal((await cache.getReplyPage('1',1)).replies[0].author,'楼主');
 await cache.saveCover('1','https://img.nga.cn/shared.png');await cache.saveCover('2','https://img.nga.cn/shared.png');
 const used=await cache.stats();assert.equal(used.posts,2);assert.equal(used.replyPages,1);assert.equal(used.images,1);assert.equal(used.imageBytes,png.size);assert.equal(downloads,1);
 await cache.remove(['1']);assert.equal(await cache.getReplyPage('1',1),null);assert(await cache.getCover('2'));
 await cache.remove(['2']);assert.equal((await cache.stats()).images,0);
});
test('clear preserves bookmarks and preferences and rejects a download started before the clear',async()=>{
 let complete,started;const began=new Promise(resolve=>started=resolve);
 const {w,cache}=setup({loadImage:()=>{started();return new Promise(resolve=>complete=resolve);}});
 w.localStorage.setItem('test',JSON.stringify({theme:'dark'}));
 await cache.setFavorite({tid:'1',title:'收藏帖',url:'https://bbs.nga.cn/read.php?tid=1'},true);
 const pending=cache.saveCover('1','https://img.nga.cn/pending.png');await began;assert(await cache.clear());complete(png);assert.equal(await pending,false);
 const used=await cache.stats();assert.equal(used.totalBytes,0);assert.equal(used.posts,0);assert.equal(used.favorites,1);assert((await cache.getFavorites())['1']);assert.equal(JSON.parse(w.localStorage.getItem('test')).theme,'dark');
 await cache.configure({enabled:false});assert((await cache.getFavorites())['1']);assert.equal((await cache.stats()).enabled,false);assert.equal(await cache.visit({tid:'2'}),null);
});
test('version 1 covers, legacy list pages and favorites migrate without keeping content in localStorage',async()=>{
 const factory=new IDBFactory(),now=Date.now();
 await new Promise((resolve,reject)=>{const request=factory.open('test-posts',1);request.onupgradeneeded=()=>{request.result.createObjectStore('posts',{keyPath:'tid'});request.result.createObjectStore('images',{keyPath:'tid'});};request.onsuccess=()=>{const db=request.result,tx=db.transaction(['posts','images'],'readwrite');tx.objectStore('posts').put({tid:'1',title:'原封面帖子',lastAccess:now,source:'https://img.nga.cn/old.png',bytes:png.size});tx.objectStore('images').put({tid:'1',source:'https://img.nga.cn/old.png',blob:png});tx.oncomplete=()=>{db.close();resolve();};};request.onerror=()=>reject(request.error);});
 const item={tid:'2',title:'旧列表帖',author:'作者',time:'',url:'https://bbs.nga.cn/read.php?tid=2',lastAccess:now};
 const {w,cache}=setup({factory},{'test-list-cache':{version:1,pages:[{key:'https://bbs.nga.cn/thread.php?fid=1',number:1,url:'https://bbs.nga.cn/thread.php?fid=1',next:null,at:now,items:[item]}]},'test-favorites':{'2':item}});
 assert(await cache.ready);assert(await cache.getCover('1'));assert.equal((await cache.getListPages('https://bbs.nga.cn/thread.php?fid=1'))[0].items[0].tid,'2');assert((await cache.getFavorites())['2']);assert.equal(w.localStorage.getItem('test-list-cache'),null);assert.equal(w.localStorage.getItem('test-favorites'),null);
});
test('settings display cache usage, persist limits, and clear in one click while preserving favorites',async()=>{
 const {w,cache}=setup();await cache.saveReplyPage('1',1,[{floor:0,author:'作者',html:'<div class="postcontent">正文</div>'}],{title:'帖子'});await cache.saveCover('1','https://img.nga.cn/one.png');await cache.setFavorite({tid:'1',title:'帖子',url:'https://bbs.nga.cn/read.php?tid=1'},true);
 const host=w.document.createElement('div'),shadow=host.attachShadow({mode:'open'}),app=w.document.createElement('div');app.className='app';shadow.append(app);w.document.body.append(host);
 const prefs={theme:'dark'};w.eval(settings+';window.mountSettings=mountSettings;');const panel=w.mountSettings({context:w,shadow,app,prefs,cache,save:()=>w.localStorage.setItem('test',JSON.stringify(prefs)),change:()=>{},original:()=>{}});panel.open();
 const status=shadow.querySelector('.rt-cache-usage');await waitFor(()=>status.textContent.includes('帖子 1/500'));assert.match(status.textContent,/回复 1 页/);assert.match(status.textContent,/图片/);
 const limit=shadow.querySelector('[data-pref=cacheImageMB]');limit.value='100';limit.dispatchEvent(new w.Event('change'));await waitFor(()=>status.textContent.includes('100.0 MB'));assert.equal(JSON.parse(w.localStorage.getItem('test')).cacheImageMB,100);
 app.scrollTop=345;shadow.querySelector('.rt-clear-cache').click();await waitFor(()=>status.textContent.includes('缓存已清理'));assert.equal((await cache.stats()).totalBytes,0);assert((await cache.getFavorites())['1']);assert.equal(app.scrollTop,345);assert.equal(prefs.theme,'dark');
});
test('a cached reply page is reused by the reader and untrusted HTML is sanitized again',async()=>{
 const factory=new IDBFactory(),seed=setup({factory});
 const url='https://bbs.nga.cn/read.php?tid=1&page=2';
 await seed.cache.saveReplyPage('1',2,[{key:'pid:20',pid:'20',floor:20,author:'缓存作者',time:'',base:url,original:url+'#pid20Anchor',replyURL:'https://bbs.nga.cn/post.php?action=reply&tid=1',quoteURL:'https://bbs.nga.cn/post.php?action=quote&tid=1',refs:[],html:'<div class="postcontent">缓存回复<script>window.cacheScriptExecuted=true</script><a href="javascript:alert(1)">危险链接</a></div>'}],{next:false,title:'缓存标题',url});
 // The adapter uses its configured database name, so seed this database through the same service.
 const correct=seed.w.createPostCache({context:seed.w,key:'nga-cards-v1',loadImage:async()=>png});sessions.push({w:seed.w,cache:correct});
 const saved=await seed.cache.getReplyPage('1',2);await correct.saveReplyPage('1',2,saved.replies,{next:false,title:'缓存标题',url});
 const d=new JSDOM('<head></head><body><div id="pagebtop"><a href="/read.php?tid=1&page=2">后页</a></div><table><tr><td><a>#0</a><a id="postauthor0">楼主</a></td><td id="postcontainer0"><a id="pid1Anchor"></a><div id="postcontent0" class="postcontent">首楼</div></td></tr></table></body>',{url:'https://bbs.nga.cn/read.php?tid=1',runScripts:'dangerously',virtualConsole:new VirtualConsole()});
 const w=d.window;sessions.push({w});w.indexedDB=factory;w.fetch=()=>{throw new Error('缓存页不应发起正文请求');};w.eval(bundle);const root=w.document.querySelector('#nga-cards-host').shadowRoot;
 root.querySelector('.load-next').click();await waitFor(()=>root.querySelectorAll('.reader-page').length===2);assert.match(root.querySelector('.reader-status').textContent,/本地缓存/);assert.match(root.textContent,/缓存回复/);assert.equal(root.querySelector('script'),null);assert.equal(root.querySelector('a[href^="javascript:"]'),null);assert.equal(w.cacheScriptExecuted,undefined);
});
