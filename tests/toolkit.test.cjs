const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const fs=require('node:fs');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../dist/readscape-nga.user.js'),'utf8');
const core=fs.readFileSync(path.join(__dirname,'../src/core/navigation.js'),'utf8');
const fixture=`<head><title>测试 NGA玩家社区</title></head><body><table id="topicrows"><tr class="topicrow"><td class="c1"><a class="replies" href="/read.php?tid=123">18</a></td><td class="c4"><a class="replydate" href="/read.php?tid=123&page=e">今天 13:59</a></td><td class="c2"><a class="topic" href="/read.php?tid=123">真正的帖子标题</a></td><td class="c3"><a class="author">作者</a></td></tr></table></body>`;
function dom(html=fixture){return new JSDOM(html,{url:'https://bbs.nga.cn/thread.php?stid=10',runScripts:'dangerously',virtualConsole:new VirtualConsole()});}
test('reading hides native layout including late content and restores native styles and scroll',async()=>{
  const d=dom(),w=d.window;
  w.document.body.style.cssText='background:#ffff00;overflow:scroll;transform:translateY(10px)';
  w.document.documentElement.style.overflow='auto';
  w.scrollY=180;
  w.scrollTo=({left,top})=>{w.scrollX=left;w.scrollY=top;};
  const nativeStyle=w.document.body.getAttribute('style');
  w.eval(script);
  const host=w.document.querySelector('#nga-cards-host'),r=host.shadowRoot,app=r.querySelector('.app');
  assert.equal(host.parentElement,w.document.documentElement,'reader is outside native layout');
  assert.equal(w.getComputedStyle(w.document.body).display,'none');
  assert.equal(w.getComputedStyle(host).position,'fixed');
  app.scrollTop=240;
  const late=w.document.createElement('div');late.textContent='晚到的黄色背景';w.document.body.append(late);
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(w.getComputedStyle(w.document.body).display,'none');
  assert.equal(app.scrollTop,240);
  w.scrollY=0;
  r.querySelector('.bar .pill').click();
  assert.equal(w.document.documentElement.hasAttribute('data-readscape-active'),false);
  assert.equal(w.getComputedStyle(w.document.body).display,'block');
  assert.equal(w.document.body.getAttribute('style'),nativeStyle);
  assert.equal(w.document.documentElement.style.overflow,'auto');
  assert.equal(w.scrollY,180);
  r.querySelector('.restore').click();
  assert.equal(w.getComputedStyle(w.document.body).display,'none');
  assert.equal(app.scrollTop,240);
  d.window.close();
});
test('unsupported pages keep native content visible',()=>{
  const d=dom('<body>请先登录</body>');d.window.eval(script);
  assert.equal(d.window.document.documentElement.hasAttribute('data-readscape-active'),false);
  assert.equal(d.window.getComputedStyle(d.window.document.body).display,'block');d.window.close();
});
test('reply time before title is excluded; topicrow is not a pinned class',()=>{
  const d=dom();d.window.eval(script);const r=d.window.document.querySelector('#nga-cards-host').shadowRoot;
  assert.equal(r.querySelector('.title').textContent,'真正的帖子标题');
  assert.equal(r.querySelector('.tag'),null);d.window.close();
});
test('settings persist, layout changes, reset and keyboard dismissal work',async()=>{
  const d=dom(),w=d.window;w.eval(script);const r=w.document.querySelector('#nga-cards-host').shadowRoot;
  r.querySelector('.rt-fab').click();assert.equal(r.querySelector('.rt-mask').hidden,false);
  function set(key,value){const c=r.querySelector(`[data-pref=${key}]`);if(c.type==='checkbox')c.checked=value;else c.value=value;c.dispatchEvent(new w.Event(c.type==='range'?'input':'change'));}
  set('theme','dark');set('font','serif');set('fontScale','1.2');set('single',true);
  assert(r.querySelector('.app').classList.contains('rt-dark'));
  assert.match(r.querySelector('.app').style.getPropertyValue('--rt-font'),/Songti/);
  assert.equal(r.querySelector('.app').style.getPropertyValue('--rt-scale'),'1.2');
  assert(r.querySelector('.grid').classList.contains('single'));
  const saved=w.localStorage.getItem('nga-cards-v1');assert.equal(JSON.parse(saved).fontScale,1.2);
  const next=dom();next.window.localStorage.setItem('nga-cards-v1',saved);next.window.eval(script);
  assert(next.window.document.querySelector('#nga-cards-host').shadowRoot.querySelector('.app').classList.contains('rt-dark'));next.window.close();
  r.querySelector('.rt-mask').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert(r.querySelector('.rt-mask').hidden);
  r.querySelector('.rt-fab').click();r.querySelector('.rt-actions button').click();assert(!r.querySelector('.app').classList.contains('rt-dark'));assert(!r.querySelector('.grid').classList.contains('single'));
  // NGA 后续脚本重写 viewport 后恢复移动端视口。
  const v=w.document.querySelector('meta[name=viewport]');v.content='width=1024';await new Promise(resolve=>w.setTimeout(resolve,20));
  assert.equal(v.content,'width=device-width, initial-scale=1, viewport-fit=cover');
  r.querySelectorAll('.rt-actions button')[1].click();assert(r.querySelector('.app').hidden);assert(r.querySelector('.rt-fab').hidden);d.window.close();
});
test('compact settings allow live page preview, expose switches and close by cancel/backdrop/swipe',()=>{
  const d=dom(),w=d.window;w.eval(script);const r=w.document.querySelector('#nga-cards-host').shadowRoot;
  const app=r.querySelector('.app'),fab=r.querySelector('.rt-fab'),mask=r.querySelector('.rt-mask');
  app.style.overflow='auto';app.scrollTop=237;
  // Exercise the native dialog route as well as the jsdom fallback used by other tests.
  let opens=0,closes=0;mask.show=()=>{opens++;mask.setAttribute('open','');};mask.close=()=>{closes++;mask.removeAttribute('open');};
  fab.click();assert.equal(opens,1);assert(mask.open);assert(!app.inert);assert.equal(app.style.overflow,'auto');assert.equal(r.querySelector('.rt-more').open,false);
  assert.equal(r.querySelectorAll('input[role=switch]').length,4);
  const scale=r.querySelector('[data-pref=fontScale]');scale.value='1.25';scale.dispatchEvent(new w.Event('input'));
  assert.equal(r.querySelector('.rt-scale').textContent,'125%');assert(!app.inert);
  const cancel=new w.Event('cancel',{cancelable:true});mask.dispatchEvent(cancel);assert(cancel.defaultPrevented);assert(mask.hidden);assert(!app.inert);assert.equal(app.style.overflow,'auto');assert.equal(app.scrollTop,237);assert.equal(r.activeElement,fab);
  fab.click();mask.click();assert(mask.hidden);
  fab.click();const handle=r.querySelector('.rt-handle');
  for(const [type,y] of [['pointerdown',10],['pointerup',100]]) { const event=new w.Event(type);Object.defineProperty(event,'clientY',{value:y});handle.dispatchEvent(event); }
  assert(mask.hidden);assert.equal(closes,3);
  fab.click();r.querySelectorAll('.rt-actions button')[1].click();assert(app.hidden);assert(!app.inert);assert(mask.hidden);assert.equal(fab.getAttribute('aria-expanded'),'false');d.window.close();
});
test('native navigation cover, modifier exemptions, timeout, back and disabled preference',()=>{
  const d=dom('<head></head><body><a id="go" href="/read.php?tid=2">go</a><a id="outside" href="https://example.com/">outside</a></body>'),w=d.window;
  let expire;w.setTimeout=fn=>{expire=fn;return 1;};w.clearTimeout=()=>{};
  w.eval(core+`;window.navigationUnderTest=createNavigation({storageKey:'nga-cards-v1',accepts:u=>['/read.php','/thread.php'].includes(u.pathname)});`);
  const a=w.document.querySelector('#go');
  // listener is readied before cancelling jsdom's actual navigation
  w.document.addEventListener('click',e=>e.preventDefault());
  a.dispatchEvent(new w.MouseEvent('click',{bubbles:true,ctrlKey:true}));assert.equal(w.sessionStorage.getItem('reader-toolkit-transition'),null);
  a.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));assert(w.sessionStorage.getItem('reader-toolkit-transition'));assert.match(w.document.documentElement.textContent,/正在打开页面/);
  expire();assert.equal(w.sessionStorage.getItem('reader-toolkit-transition'),null);assert.doesNotMatch(w.document.documentElement.textContent,/正在打开页面/);
  a.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));w.dispatchEvent(new w.PageTransitionEvent('pageshow',{persisted:true}));assert.equal(w.sessionStorage.getItem('reader-toolkit-transition'),null);
  w.localStorage.setItem('nga-cards-v1',JSON.stringify({smoothNavigation:false}));a.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));assert.equal(w.sessionStorage.getItem('reader-toolkit-transition'),null);d.window.close();
});
test('pending transition is restored early, and DOM-ready initialization is safe',()=>{
  const d=dom(),w=d.window;w.sessionStorage.setItem('reader-toolkit-transition',JSON.stringify({at:Date.now(),origin:w.location.origin}));
  const originalBody=w.document.body;originalBody.remove();w.eval(script);
  assert.match(w.document.documentElement.textContent,/正在打开页面/);assert.equal(w.document.querySelector('#nga-cards-host'),null);
  w.document.documentElement.append(originalBody);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  assert(w.document.querySelector('#nga-cards-host'));assert.doesNotMatch(w.document.documentElement.textContent,/正在打开页面/);d.window.close();
});
test('background comments preserve list until ready, support back/forward, cancellation and timeout', async()=>{
  const d=dom(),w=d.window;w.eval(script);
  const root=w.document.querySelector('#nga-cards-host').shadowRoot;
  const list=root.querySelector('.app');list.scrollTop=237;
  let poll,expire;w.setInterval=fn=>{poll=fn;return 1;};w.clearInterval=()=>{};
  w.setTimeout=fn=>{expire=fn;return 1;};w.clearTimeout=()=>{};
  const open=()=>root.querySelector('.cover').dispatchEvent(new w.MouseEvent('click',{bubbles:true,composed:true,cancelable:true}));
  const frame=()=>w.document.querySelector('iframe[data-readscape-reader]');
  open();assert(frame());assert.equal(frame().style.visibility,'hidden');
  assert.equal(list.hidden,false);assert.equal(list.scrollTop,237);
  assert.match(w.location.href,/thread.php/);assert.equal(w.sessionStorage.getItem('reader-toolkit-transition'),null);
  const child=frame().contentWindow;
  child.document.open();child.document.write('<body><table><tr><td><a>#0</a><a id="postauthor0">作者</a></td><td id="postcontainer0"><a id="pid1Anchor"></a><h3 id="postsubject0">后台帖子</h3><div class="postcontent" id="postcontent0">评论正文</div></td></tr></table></body>');child.document.close();
  child.document.title='后台帖子';
  await new Promise(resolve=>setTimeout(resolve,0));
  poll();
  assert(child.document.querySelector('#nga-cards-host')?.shadowRoot.querySelector('.reader'),'parent initializes reader even when userscript skips every child frame');
  assert.equal(frame().style.visibility,'visible');assert.equal(w.document.title,'后台帖子');
  assert.equal(child.getComputedStyle(child.document.body).display,'none','child native page is not rendered');
  assert.equal(list.style.visibility,'hidden');assert.equal(list.inert,true);assert.equal(list.style.overflow,'hidden');
  assert.match(w.location.href,/read.php/);assert.equal(w.history.state.readscapeReader,root.querySelector('.cover').href);
  const historyState=w.history.state;
  // Simulate restored history entries deterministically (jsdom traversal is asynchronous).
  w.history.replaceState(null,'','/thread.php?stid=10');w.dispatchEvent(new w.PopStateEvent('popstate',{state:null}));
  assert.equal(frame(),null);assert.equal(list.scrollTop,237);assert.equal(w.document.title,'测试 NGA玩家社区');
  assert.equal(list.style.visibility,'');assert.equal(list.inert,false);assert.equal(list.style.overflow,'');
  w.history.replaceState(historyState,'',historyState.readscapeReader);w.dispatchEvent(new w.PopStateEvent('popstate',{state:historyState}));
  assert(frame(),'forward recreates background reader');
  w.history.replaceState(null,'','/thread.php?stid=10');w.dispatchEvent(new w.PopStateEvent('popstate',{state:null}));
  open();const notice=w.document.querySelector('[role=status]');notice.querySelector('button').click();assert.equal(frame(),null);
  open();expire();assert.equal(frame(),null);assert.equal(w.document.querySelector('[role=status]'),null);assert.equal(list.scrollTop,237);assert.match(w.location.href,/thread.php/);
  d.window.close();
});
test('unowned embedded frames do not run the userscript',()=>{
  const d=dom();const frame=d.window.document.createElement('iframe');d.window.document.body.append(frame);
  frame.contentWindow.document.body.innerHTML=fixture;frame.contentWindow.eval(script);
  assert.equal(frame.contentDocument.querySelector('#nga-cards-host'),null);d.window.close();
});
test('background timeout and initialization errors automatically use native navigation',async()=>{
  const d=dom(),w=d.window;
  const host=w.document.createElement('div');host.id='nga-cards-host';
  host.attachShadow({mode:'open'}).innerHTML='<div class="app"></div>';w.document.body.append(host);
  const destinations=[];let expire,poll;
  w.setTimeout=fn=>{expire=fn;return 1;};w.clearTimeout=()=>{};
  w.setInterval=fn=>{poll=fn;return 1;};w.clearInterval=()=>{};
  w.testContext={
    top:w,self:w,document:w.document,history:w.history,localStorage:w.localStorage,sessionStorage:w.sessionStorage,
    location:{href:w.location.href,origin:w.location.origin,pathname:w.location.pathname,search:w.location.search,assign:url=>destinations.push(url)},
    addEventListener:w.addEventListener.bind(w),removeEventListener:w.removeEventListener.bind(w),
  };
  w.eval(core+`;createNavigation({storageKey:'nga-cards-v1',accepts:u=>['/read.php','/thread.php'].includes(u.pathname),mountReader:()=>{throw new Error('reader failed');}},window.testContext);`);
  const a=w.document.createElement('a');a.href='/read.php?tid=2';w.document.body.append(a);
  const open=()=>a.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));
  open();expire();assert.deepEqual(destinations,['https://bbs.nga.cn/read.php?tid=2']);
  assert.equal(w.document.querySelector('iframe[data-readscape-reader]'),null);
  open();const child=w.document.querySelector('iframe[data-readscape-reader]').contentWindow;
  child.document.open();child.document.write('<body>原站帖子</body>');child.document.close();
  await new Promise(resolve=>setTimeout(resolve,0));poll();
  assert.equal(destinations.length,2,'initialization failure completes the click using native navigation');
  expire();assert.equal(destinations.length,2,'stale timeout cannot trigger a second navigation');
  assert.equal(w.document.querySelector('iframe[data-readscape-reader]'),null);d.window.close();
});

test('top menu opens native login and settings without scrolling to the pager',()=>{
  const d=dom(),w=d.window;let logins=0;
  const login=w.document.createElement('button');login.textContent='登录';login.onclick=()=>logins++;w.document.body.append(login);
  w.eval(script);const r=w.document.querySelector('#nga-cards-host').shadowRoot;
  r.querySelector('.toolbar-menu').click();assert(r.querySelector('.app').classList.contains('options-open'));
  r.querySelector('.settings-reading').click();assert(!r.querySelector('.rt-mask').hidden);
  assert(!r.querySelector('.app').inert);
  r.querySelector('.rt-close').click();r.querySelector('.settings-login').click();
  assert.equal(logins,1);assert(r.querySelector('.app').hidden);assert(r.querySelector('.rt-mask').hidden);
  assert.doesNotMatch(r.querySelector('.pager').textContent,/登录/);w.close();
});
