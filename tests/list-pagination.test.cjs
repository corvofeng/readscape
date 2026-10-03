const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const fs=require('node:fs');
const {IDBFactory}=require('fake-indexeddb');
const bundle=fs.readFileSync(__dirname+'/../dist/readscape-nga.user.js','utf8');
const cacheKey='nga-cards-v1-list-cache';
const row=(tid,title=`测试帖子 ${tid}`)=>`<tr><td class="c1">120</td><td class="c2"><a class="topic" href="/read.php?tid=${tid}">${title}</a></td><td class="c3"><a class="author">作者</a></td></tr>`;
const html=(ids,next,board=1)=>`<head><title>测试板块</title></head><body>${next?`<a href="/thread.php?fid=${board}&page=${next}">后页</a>`:'<script>var __PAGE = {0:"/thread.php",1:0,2:1,3:35};</script>'}<table id="topicrows">${ids.map(id=>row(id)).join('')}</table></body>`;
const response=(url,body)=>({ok:true,url,headers:{get:()=>''},arrayBuffer:async()=>new TextEncoder().encode(body).buffer});
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
const metadata=(total,page)=>`<script>var __PAGE = {0:'/thread.php?fid=1', 1: ${total}, 2: ${page}, 3: 35};</script>`;
async function setup({body=html([1,2],2),url='https://bbs.nga.cn/thread.php?fid=1',mobile=false,cache,observer=false,factory=new IDBFactory()}={}){
 const dom=new JSDOM(body,{url,runScripts:'dangerously',virtualConsole:new VirtualConsole()}),w=dom.window;
 w.indexedDB=factory;w.Blob=Blob;w.TextDecoder=TextDecoder;w.scrollY=0;w.scrollX=0;w.scrollTo=({top,left=0})=>{w.scrollY=top;w.scrollX=left;};
 w.matchMedia=()=>({matches:mobile,addEventListener:()=>{},removeEventListener:()=>{}});
 const observers=[];
 if(observer)w.IntersectionObserver=class{constructor(callback,options){this.callback=callback;this.options=options;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
 if(cache)w.localStorage.setItem(cacheKey,cache);
 w.localStorage.setItem('nga-cards-v1', JSON.stringify({ enabled: true, autoListRefresh: false }));
 w.eval(bundle);
 for(let i=0;i<100&&w.document.querySelector('#nga-cards-host')?.shadowRoot.querySelector('.grid')?.getAttribute('aria-busy')==='true';i++)await tick();
 return {w,dom,factory,root:w.document.querySelector('#nga-cards-host').shadowRoot,observers};
}
test('desktop and mobile append pages without detaching existing cards, moving scroll or duplicating pinned posts',async()=>{
 for(const mobile of [false,true]){
  const {w,root}=await setup({mobile});
  try{
   const grid=root.querySelector('.grid'),app=root.querySelector('.app'),old=[...grid.children],removed=[];
   const mutation=new w.MutationObserver(changes=>changes.forEach(change=>removed.push(...change.removedNodes)));
   mutation.observe(grid,{childList:true});w.scrollY=760;app.scrollTop=760;
   let writes=0;w.scrollTo=()=>writes++;
   let calls=0;w.fetch=async url=>{calls++;return response(url,html([1,3,4],3));};
   root.querySelector('.list-load').click();root.querySelector('.list-load').click();await tick();
   assert.equal(calls,1);assert.deepEqual([...grid.children].map(card=>card.dataset.tid),['1','2','3','4']);
   assert.equal(grid.children[0],old[0]);assert.equal(grid.children[1],old[1]);assert(!old.some(card=>removed.includes(card)));
   assert.equal(writes,0);assert.equal(w.scrollY,760);assert.equal(app.scrollTop,760);assert.match(root.querySelector('.sub').textContent,/1–2/);
   old[0].querySelector('.save').click();
   root.querySelector('[data-tab=hot]').click();assert.equal(grid.children[0],old[0]);
   assert.equal(old[0].querySelector('.save').getAttribute('aria-pressed'),'true');
   w.fetch=async url=>response(url,html([5],null));root.querySelector('.list-load').click();await tick();
   assert.equal(grid.children[0],old[0]);assert.equal(grid.children.length,5);assert(root.querySelector('.list-load').hidden);
   assert.match(root.querySelector('.list-status').textContent,/已经到底了/);mutation.disconnect();
  }finally{w.close();}
 }
});
test('the bottom sentinel auto-loads only the unfiltered visible list and pauses on errors',async()=>{
 const {w,root,observers}=await setup({mobile:true,observer:true});
 try{
  let calls=0;w.fetch=async()=>{calls++;throw new Error('离线');};
  assert.equal(observers.at(-1).options.root,null);
  root.querySelector('[data-tab=hot]').click();observers.at(-1).callback([{isIntersecting:true}]);assert.equal(calls,0);
  root.querySelector('[data-tab=all]').click();const input=root.querySelector('input[type=search]');input.value='测试';input.dispatchEvent(new w.Event('input'));
  observers.at(-1).callback([{isIntersecting:true}]);assert.equal(calls,0);
  input.value='';input.dispatchEvent(new w.Event('input'));observers.at(-1).callback([{isIntersecting:true}]);await tick();assert.equal(calls,1);
  observers.at(-1).callback([{isIntersecting:true}]);assert.equal(calls,1);assert.match(root.querySelector('.list-load').textContent,/重试/);
  w.fetch=async url=>{calls++;return response(url,html([3],null));};root.querySelector('.list-load').click();await tick();assert.equal(calls,2);
 }finally{w.close();}
});
test('NGA script pagination auto-loads through page 15 without rendered pager links',async()=>{
 const {w,root,observers}=await setup({body:html([1],null).replace(/<script>.*?<\/script>/,metadata(524,1)),observer:true});
 try{
  const old=root.querySelector('.card'),requested=[];
  w.fetch=async url=>{const page=Number(new URL(url).searchParams.get('page'));requested.push(page);return response(url,html([1,page],null).replace(/<script>.*?<\/script>/,metadata(524,page)));};
  for(let page=2;page<=15;page++){
   assert(!root.querySelector('.list-load').hidden);
   observers.at(-1).callback([{isIntersecting:true}]);await tick();
   assert.equal(root.querySelector('.card'),old);
   assert.equal(root.querySelectorAll('.card').length,page);
  }
  observers.at(-1).callback([{isIntersecting:true}]);await tick();
  assert.deepEqual(requested,Array.from({length:14},(_,i)=>i+2));
  assert(root.querySelector('.list-load').hidden);assert.equal(root.querySelector('.list-status').textContent,'已经到底了');
 }finally{w.close();}
});
test('unknown pagination probes the next native page and stops on duplicates',async()=>{
 const {w,root,observers}=await setup({body:html([1],null).replace(/<script>.*?<\/script>/,''),observer:true});
 try{
  const requested=[];
  w.fetch=async url=>{requested.push(url);return response(url,html([1,2],null).replace(/<script>.*?<\/script>/,''));};
  observers.at(-1).callback([{isIntersecting:true}]);await tick();assert.equal(root.querySelectorAll('.card').length,2);
  observers.at(-1).callback([{isIntersecting:true}]);await tick();assert(root.querySelector('.list-load').hidden);
  observers.at(-1).callback([{isIntersecting:true}]);await tick();
  assert.deepEqual(requested.map(url=>new URL(url).searchParams.get('page')),['2','3']);
 }finally{w.close();}
});
test('late native pagination updates controls even when cards are unchanged and refresh is disabled',async()=>{
 const {w,root}=await setup({body:html([1],null)});
 try{
  assert(root.querySelector('.list-load').hidden);
  root.querySelector('[data-tab=all]').click();
  w.__PAGE={0:'/thread.php?fid=1',1:469,2:1,3:35};
  w.document.querySelector('table').insertAdjacentHTML('beforebegin','<div id="pagebbtm"><a href="?fid=1&page=2" title="下一页">继续</a></div>');
  await new Promise(resolve=>setTimeout(resolve,300));
  assert(!root.querySelector('.list-load').hidden);assert.notEqual(root.querySelector('.list-status').textContent,'已经到底了');
 }finally{w.close();}
});
test('cached end markers recover when native pagination indicates more pages',async()=>{
 const factory=new IDBFactory(),first=await setup({factory,body:html([1],null)});
 await tick();await tick();first.w.close();
 const {w,root}=await setup({factory,body:html([1],2)});
 try{
  assert(!root.querySelector('.list-load').hidden);
  let requested;w.fetch=async url=>{requested=url;return response(url,html([2],null));};
  root.querySelector('.list-load').click();await tick();
  assert.equal(new URL(requested).searchParams.get('page'),'2');assert.equal(root.querySelectorAll('.card').length,2);
 }finally{w.close();}
});
test('cache resumes contiguous pages without fetching, and isolates boards and thread pages',async()=>{
 const factory=new IDBFactory();const first=await setup({factory});
 try{first.w.fetch=async url=>response(url,html([3],3));first.root.querySelector('.list-load').click();await tick();await tick();}finally{first.w.close();}
 const same=await setup({factory}),other=await setup({factory,url:'https://bbs.nga.cn/thread.php?fid=2',body:html([9],2,2)}),reader=await setup({factory,url:'https://bbs.nga.cn/read.php?tid=1',body:'<body>登录</body>'});
 try{
  await tick();await tick();assert.equal(same.root.querySelectorAll('.card').length,3);assert.match(same.root.querySelector('.sub').textContent,/1–2/);
  assert.equal(other.root.querySelectorAll('.card').length,1);assert.equal(reader.w.localStorage.getItem(cacheKey),null);
  let requested;same.w.fetch=async url=>{requested=url;return response(url,html([4],null));};same.root.querySelector('.list-load').click();await tick();
  assert.equal(new URL(requested).searchParams.get('page'),'3');
 }finally{same.w.close();other.w.close();reader.w.close();}
});
test('login pages, wrong redirects and duplicate pages preserve the stream and allow recovery',async()=>{
 const {w,root}=await setup();
 try{
  const old=root.querySelector('.card');
  w.fetch=async url=>response(url,'<title>请登录</title><body>登录</body>');root.querySelector('.list-load').click();await tick();
  assert.equal(root.querySelector('.card'),old);assert.match(root.querySelector('.list-status').textContent,/登录/);assert(!root.querySelector('.list-load').hidden);
  w.fetch=async()=>response('https://bbs.nga.cn/thread.php?fid=2&page=2',html([9],null,2));root.querySelector('.list-load').click();await tick();
  assert.equal(root.querySelectorAll('.card').length,2);assert.match(root.querySelector('.list-status').textContent,/其他页面/);
  w.fetch=async url=>response(url,html([1,2],3));root.querySelector('.list-load').click();await tick();
  assert.equal(root.querySelector('.card'),old);assert(root.querySelector('.list-load').hidden);
 }finally{w.close();}
});
async function rows(factory,store='posts'){
 const open=factory.open('nga-cards-v1-posts');
 return new Promise((resolve,reject)=>{open.onsuccess=()=>{const db=open.result,tx=db.transaction(store),request=tx.objectStore(store).getAll();tx.oncomplete=()=>{db.close();resolve(request.result);};};open.onerror=()=>reject(open.error);});
}
test('IndexedDB enforces the global 500-post budget and list data no longer uses localStorage',async()=>{
 const factory=new IDBFactory();
 const first=await setup({factory,body:html(Array.from({length:260},(_,i)=>i+1),null)});
 await new Promise(resolve=>setTimeout(resolve,100));first.w.close();
 const {w,root}=await setup({factory,url:'https://bbs.nga.cn/thread.php?fid=2',body:html(Array.from({length:260},(_,i)=>i+1000),2,2)});
 try{
  await new Promise(resolve=>setTimeout(resolve,200));assert((await rows(factory)).length<=500);assert.equal(w.localStorage.getItem(cacheKey),null);
  w.fetch=async url=>response(url,html([2000],null,2));root.querySelector('.list-load').click();await tick();
  assert.equal(root.querySelectorAll('.card').length,261);assert.equal(w.localStorage.getItem(cacheKey),null);
 }finally{w.close();}
});
test('the cache evicts pages over 10 MB while keeping their cards available in the current stream',async()=>{
 const {w,root,factory}=await setup();
 try{
  w.fetch=async url=>response(url,`<body><table>${row(3,'长'.repeat(5*1024*1024+1))}</table></body>`);
  root.querySelector('.list-load').click();await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(root.querySelectorAll('.card').length,3);
  assert.equal(w.localStorage.getItem(cacheKey),null);assert(!(await rows(factory)).some(p=>p.tid==='3'));
 }finally{w.close();}
});
test('expired list pages are discarded instead of being revived by cache hydration',async()=>{
 const old=Date.now()-8*86400000;
 const cache=JSON.stringify({version:1,pages:[{key:'https://bbs.nga.cn/thread.php?fid=1',number:2,url:'https://bbs.nga.cn/thread.php?fid=1&page=2',next:null,at:old,items:[{tid:'3',title:'过期帖子',author:'作者',time:'',url:'https://bbs.nga.cn/read.php?tid=3',latest:'',lastAccess:old}]}]});
 const {w,root}=await setup({cache});
 try{for(let attempt=0;attempt<100&&w.localStorage.getItem(cacheKey)!==null;attempt++)await tick();assert.equal(root.querySelectorAll('.card').length,2);assert(!root.querySelector('.list-load').hidden);assert.equal(w.localStorage.getItem(cacheKey),null);}finally{w.close();}
});

test('thread.php ignores page parameter and always starts at page 1, fetching page 1 and paginating to page 2', async () => {
  const nativeHTML = html([1201, 1202], 13);
  let requested = [];
  const fetcher = async (url) => {
    requested.push(url);
    const u = new URL(url);
    const p = Number(u.searchParams.get('page') || 1);
    if (p === 1) return response(url, html([1, 2], 2));
    if (p === 2) return response(url, html([3, 4], 3));
    return response(url, html([], null));
  };
  const d = new JSDOM(nativeHTML, {
    url: 'https://bbs.nga.cn/thread.php?stid=47206901&page=12',
    runScripts: 'dangerously',
    virtualConsole: new VirtualConsole()
  });
  const w = d.window;
  w.TextDecoder = TextDecoder;
  w.fetch = fetcher;
  w.localStorage.setItem('nga-cards-v1', JSON.stringify({ enabled: true, autoListRefresh: false }));
  w.eval(bundle);
  for (let i = 0; i < 100 && w.document.querySelector('#nga-cards-host')?.shadowRoot.querySelector('.grid')?.getAttribute('aria-busy') === 'true'; i++) await tick();
  const root = w.document.querySelector('#nga-cards-host').shadowRoot;
  try {
    assert.doesNotMatch(w.location.href, /page=12/);
    assert.match(w.location.href, /stid=47206901/);

    const cardTids = [...root.querySelectorAll('.card')].map(c => c.dataset.tid);
    assert.equal(cardTids.includes('1201'), false);
    assert.equal(cardTids.includes('1202'), false);
    assert.deepEqual(cardTids, ['1', '2']);
    assert.match(root.querySelector('.sub').textContent, /第 1/);

    root.querySelector('.list-load').click();
    await tick();

    const updatedTids = [...root.querySelectorAll('.card')].map(c => c.dataset.tid);
    assert.deepEqual(updatedTids, ['1', '2', '3', '4']);
    assert.match(root.querySelector('.sub').textContent, /第 1–2/);
  } finally {
    w.close();
  }
});

