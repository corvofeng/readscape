const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const fs=require('node:fs');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../dist/readscape-nga.user.js'),'utf8');
const core=fs.readFileSync(path.join(__dirname,'../src/core/navigation.js'),'utf8');
const fixture=`<head><title>测试 NGA玩家社区</title></head><body><table id="topicrows"><tr class="topicrow"><td class="c1"><a class="replies" href="/read.php?tid=123">18</a></td><td class="c4"><a class="replydate" href="/read.php?tid=123&page=e">今天 13:59</a></td><td class="c2"><a class="topic" href="/read.php?tid=123">真正的帖子标题</a></td><td class="c3"><a class="author">作者</a></td></tr></table></body>`;
function dom(html=fixture){return new JSDOM(html,{url:'https://bbs.nga.cn/thread.php?stid=10',runScripts:'dangerously',virtualConsole:new VirtualConsole()});}
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
