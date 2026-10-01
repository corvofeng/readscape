const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const fs=require('node:fs');
const bundle=fs.readFileSync(__dirname+'/../dist/readscape-nga.user.js','utf8');
const list='<table id="topicrows"><tr><td class="c1">12</td><td class="c2"><a class="topic" href="/read.php?tid=1">测试标题</a></td><td class="c3"><a class="author">作者</a></td></tr></table>';
function page(path='/thread.php?fid=-7',html=list){
 const d=new JSDOM('<head></head><body>'+html+'</body>',{url:'https://bbs.nga.cn'+path,runScripts:'dangerously',virtualConsole:new VirtualConsole()});
 const w=d.window;let change;
 const media={matches:true,addEventListener:(type,fn)=>change=fn,removeEventListener:()=>{}};
 w.matchMedia=()=>media;w.scrollY=120;w.scrollX=0;w.scrollTo=({top,left=0})=>{w.scrollY=top;w.scrollX=left;};
 w.eval(bundle);return {d,w,root:w.document.querySelector('#nga-cards-host').shadowRoot,media,resize:()=>change()};
}
test('mobile uses document scrolling and preserves reading/native positions across toggles and resize',()=>{
 const {w,root,media,resize}=page();const html=w.document.documentElement,app=root.querySelector('.app');
 assert(html.hasAttribute('data-readscape-document-scroll'));assert(app.classList.contains('document-scroll'));
 assert.equal(w.getComputedStyle(w.document.body).display,'none');assert.equal(w.getComputedStyle(root.host).position,'relative');
 assert.equal(w.scrollY,0);w.scrollY=320;
 root.querySelector('.bar .pill').click();assert.equal(w.scrollY,120);assert(!html.hasAttribute('data-readscape-document-scroll'));
 root.querySelector('.restore').click();assert.equal(w.scrollY,320);
 media.matches=false;resize();assert(!html.hasAttribute('data-readscape-document-scroll'));assert.equal(app.scrollTop,320);
 app.scrollTop=470;media.matches=true;resize();assert.equal(w.scrollY,470);
 root.querySelector('.rt-fab').click();assert(!app.inert);assert.equal(html.style.overflow,'auto');
 w.close();
});
test('mobile topic overlay retains the same list and position across back, forward and cancellation',async()=>{
 const {w,root}=page(),html=w.document.documentElement,app=root.querySelector('.app'),card=root.querySelector('.cover');
 let poll;w.setInterval=fn=>{poll=fn;return 1;};w.clearInterval=()=>{};
 const frame=()=>w.document.querySelector('iframe[data-readscape-reader]');
 const open=()=>card.dispatchEvent(new w.MouseEvent('click',{bubbles:true,composed:true,cancelable:true}));
 async function ready(){
  const child=frame().contentWindow;
  child.matchMedia=()=>({matches:true,addEventListener:()=>{},removeEventListener:()=>{}});
  child.scrollTo=()=>{};
  child.document.open();child.document.write('<body><table><tr><td><a id="postauthor0">作者</a></td><td id="postcontainer0"><div id="postcontent0" class="postcontent">正文</div></td></tr></table></body>');child.document.close();
  await new Promise(resolve=>setTimeout(resolve,0));poll();
  assert(child.document.documentElement.hasAttribute('data-readscape-document-scroll'),'mobile reader uses native document scrolling too');
 }
 const back=()=>{w.history.replaceState(null,'','/thread.php?fid=-7');w.dispatchEvent(new w.PopStateEvent('popstate',{state:null}));};
 try{
  w.scrollY=640;open();assert(frame());assert.equal(w.scrollY,640);assert(!app.inert);
  // The user can continue scrolling while the post loads; keep the latest position.
  w.scrollY=820;await ready();
  assert.equal(frame().style.visibility,'visible');assert(app.inert);assert(html.hasAttribute('data-readscape-reader-open'));
  assert.equal(w.getComputedStyle(html).overflow,'hidden');assert.equal(w.history.scrollRestoration,'manual');
  const state=w.history.state;w.scrollY=0;back();
  assert.equal(frame(),null);assert.equal(w.scrollY,820);assert(!app.inert);assert(!html.hasAttribute('data-readscape-reader-open'));
  assert.equal(w.getComputedStyle(html).overflowY,'auto');assert.equal(root.querySelector('.cover'),card);
  w.scrollY=940;w.history.replaceState(state,'',state.readscapeReader);w.dispatchEvent(new w.PopStateEvent('popstate',{state}));await ready();
  w.scrollY=0;back();assert.equal(w.scrollY,940);assert.equal(root.querySelector('.app'),app);
  open();w.document.querySelector('[role=status] button').click();assert.equal(frame(),null);assert.equal(w.scrollY,940);
  assert.equal(w.sessionStorage.getItem('reader-toolkit-transition'),null);
 }finally{w.close();}
});
test('root scrolling hides reading header downward and restores it upward',()=>{
 const {w,root}=page(),app=root.querySelector('.app');
 w.scrollY=240;w.dispatchEvent(new w.Event('scroll'));assert(app.classList.contains('rt-chrome-hidden'));
 w.scrollY=200;w.dispatchEvent(new w.Event('scroll'));assert(!app.classList.contains('rt-chrome-hidden'));w.close();
});
test('reader preserves document scroll when changing reply layout and restores native position',()=>{
 const post='<table><tr><td><a id="postauthor0">作者</a></td><td id="postcontainer0"><a id="pid1Anchor"></a><div id="postcontent0" class="postcontent">正文</div></td></tr></table>';
 const {w,root}=page('/read.php?tid=1',post);w.scrollY=360;
 root.querySelector('[data-pref=groupReplies]').click();assert.equal(w.scrollY,360);
 root.querySelector('.rt-fab').click();root.querySelectorAll('.rt-actions button')[1].click();assert.equal(w.scrollY,120);
 root.querySelector('.restore').click();assert.equal(w.scrollY,360);w.close();
});

test('mobile pagination appends content without resetting document scroll or detaching the current page',async()=>{
 const post=floor=>`<table><tr><td><a>#${floor}</a></td><td id="postcontainer${floor}"><a id="pid${floor}Anchor"></a><div id="postcontent${floor}" class="postcontent">正文 ${floor}</div></td></tr></table>`;
 const {w,root}=page('/read.php?tid=1','<div id="pagebtop"><a href="/read.php?tid=1&page=2">后页</a></div>'+post(0)+post(1));
 try{
  w.TextDecoder=TextDecoder;w.scrollY=920;
  let scrollWrites=0;w.scrollTo=({top,left=0})=>{scrollWrites++;w.scrollY=top;w.scrollX=left;};
  const section=root.querySelector('.reader-page'),removed=[];
  const observer=new w.MutationObserver(changes=>{for(const change of changes)removed.push(...change.removedNodes);});
  observer.observe(root.querySelector('.reader-stream'),{childList:true});
  w.fetch=async url=>({ok:true,url,headers:{get:()=>''},arrayBuffer:async()=>new TextEncoder().encode('<div id="pagebtop"></div>'+post(20)).buffer});
  root.querySelector('.load-next').click();await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(root.querySelectorAll('.reader-page').length,2);assert.equal(root.querySelector('.reader-page'),section);
  assert(!removed.includes(section));assert.equal(w.scrollY,920);assert.equal(scrollWrites,0);observer.disconnect();
 }finally{w.close();}
});
