const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../src/adapters/nga/account.js','utf8');
const read=vm.runInNewContext(source+';readCurrentAccount');
const bundle=fs.readFileSync(__dirname+'/../dist/readscape-nga.user.js','utf8');
const list='<table id="topicrows"><tr><td class="c1">12</td><td class="c2"><a class="topic" href="/read.php?tid=1">测试标题</a></td><td class="c3"><a class="author">帖子作者</a></td></tr></table>';
function page(html=''){return new JSDOM('<head></head><body>'+html+list+'</body>',{url:'https://bbs.nga.cn/thread.php?fid=-7',runScripts:'dangerously',virtualConsole:new VirtualConsole()});}
function inline(w,code){const script=w.document.createElement('script');script.type='text/plain';script.textContent=code;w.document.body.append(script);}
test('session UID determines the current account; poster tables cannot identify a session',()=>{
  const d=page(),w=d.window;
  inline(w,'//userinfostart commonui.userInfo.setAll({"66226966":{"uid":66226966,"username":"f8ds"}});');
  assert.equal(read(w),null);
  w.__CURRENT_UID=62009057;w.__CURRENT_UNAME='corvofeng';
  assert.equal(read(w).uid,'62009057');assert.equal(read(w).username,'corvofeng');
  w.__CURRENT_UID=0;assert.equal(read(w),null);
  w.close();
});
test('isolated userscript reads native literals without executing page scripts',()=>{
  const d=page(),w=d.window;
  inline(w,"var __CURRENT_UID = parseInt('62009057',10), __CURRENT_UNAME = 'corvo\\u0066eng'; window.accountScriptExecuted=true;");
  assert.equal(read(w).username,'corvofeng');assert.equal(read(w).uid,'62009057');assert.equal(w.accountScriptExecuted,undefined);
  w.close();
});
test('userInfo supplies only a matching name when session UID is known',()=>{
  const d=page(),w=d.window;
  inline(w,'var __CURRENT_UID=62009057;');
  inline(w,'commonui.userInfo.setAll({"66226966":{"uid":66226966,"username":"f8ds"},"62009057":{"uid":62009057,"username":"name } with \\\"quotes\\\""}});');
  assert.equal(read(w).username,'name } with "quotes"');
  w.commonui={userInfo:{users:{62009057:{username:new w.String('cached name')}}}};
  assert.equal(read(w).username,'cached name');w.close();
});
test('late account data updates both menus and logout restores login',async()=>{
  const d=page(),w=d.window;w.eval(bundle);const root=w.document.querySelector('#nga-cards-host').shadowRoot;
  assert.equal(root.querySelector('.rt-account').textContent,'未登录 · 登录');
  assert.equal(root.querySelector('.bar .session-status').hidden,false);
  inline(w,"var __CURRENT_UID=parseInt('62009057',10),__CURRENT_UNAME='<img src=x onerror=alert(1)>'; ");
  await new Promise(r=>w.setTimeout(r,0));
  assert.equal(root.querySelector('.settings-login .account-uid').textContent,'UID 62009057');
  assert.equal(root.querySelector('.rt-account .account-name').textContent,'<img src=x onerror=alert(1)>');
  assert.equal(root.querySelector('.rt-account img'),null);
  assert.equal(root.querySelector('.bar .session-status').hidden,true);
  w.__CURRENT_UID=NaN;w.__CURRENT_UNAME='';inline(w,'// session updated');
  await new Promise(r=>w.setTimeout(r,0));
  assert.equal(root.querySelector('.rt-account').textContent,'未登录 · 登录');assert.equal(root.querySelector('.settings-login').textContent,'未登录 · 登录');
  assert.equal(root.querySelector('.bar .session-status').hidden,false);w.close();
});

test('guest readers show login status and hide posting controls; session changes preserve comment nodes',async()=>{
 const post='<table><tr><td><a id="postauthor1" href="/nuke.php?uid=123">帖子作者</a></td><td id="postcontainer1"><a>#1</a><a id="pid1Anchor"></a><div id="postcontent1" class="postcontent">正文<div class="quote">被引用的正文</div></div><a href="/post.php?action=modify&tid=1">修改</a><a href="/post.php?action=quote&tid=1">引用</a></td></tr></table>';
 const d=new JSDOM('<head></head><body>'+post+'</body>',{url:'https://bbs.nga.cn/read.php?tid=1',runScripts:'dangerously',virtualConsole:new VirtualConsole()}),w=d.window;
 try{
  w.eval(bundle);const root=w.document.querySelector('#nga-cards-host').shadowRoot,card=root.querySelector('.comment'),content=card.querySelector('.comment-content');
  const status=root.querySelector('.bar .session-status');assert.equal(status.textContent,'未登录');assert(!status.hidden);
  assert.equal(root.querySelector('.floor-reply, .floor-quote, a[href*="action=modify"]'),null);assert(root.querySelector('.reply-entry').hidden);
  assert.match(content.textContent,/被引用的正文/,'引用正文仍可阅读');
  w.__CURRENT_UID=42;w.__CURRENT_UNAME='登录用户';inline(w,'// session updated');await new Promise(r=>w.setTimeout(r,0));
  assert(status.hidden);assert(!root.querySelector('.reply-entry').hidden);assert(root.querySelector('.floor-reply'));assert(root.querySelector('.floor-quote'));
  assert.equal(root.querySelector('.comment'),card);assert.equal(card.querySelector('.comment-content'),content);
  w.__CURRENT_UID=0;inline(w,'// session cleared');await new Promise(r=>w.setTimeout(r,0));
  assert(!status.hidden);assert(root.querySelector('.reply-entry').hidden);assert.equal(root.querySelector('.floor-reply, .floor-quote'),null);
  assert.equal(root.querySelector('.comment'),card);assert.equal(card.querySelector('.comment-content'),content);
 }finally{w.close();}
});
