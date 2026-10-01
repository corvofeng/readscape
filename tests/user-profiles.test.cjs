const {test,afterEach}=require('node:test');
const windows=[];afterEach(()=>{for(const window of windows.splice(0))window.close();});
const assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const fs=require('node:fs');
const script=fs.readFileSync(__dirname+'/../dist/readscape-nga.user.js','utf8');
const post=(uid=66187805,name='Invisibl')=>`<table><tr><td><a id="postauthor0" href="/nuke.php?func=ucp&uid=${uid}"></a><a id="postauthor0" href="/nuke.php?func=ucp&uid=${uid}">${name}</a></td><td id="postcontainer0"><a id="pid1Anchor"></a><a>#0</a><h3 id="postsubject0">测试</h3><div id="postcontent0" class="postcontent">正文</div></td></tr></table>`;
const user={uid:66187805,username:'Invisibl',avatar:'https://img.nga.cn/avatars/2002/21d/f1f/003/66187805_0.jpg?92|.a/66187805_1.jpg?33',regdate:1725458735,rvrc:10,money:3000,postnum:7565,memberid:39};
function page(html,opts={}){
 const d=new JSDOM('<head></head><body>'+html+'</body>',{url:'https://bbs.nga.cn/'+(opts.path||'read.php?tid=1'),runScripts:'dangerously',virtualConsole:new VirtualConsole()});
 windows.push(d.window);d.window.TextDecoder=TextDecoder;if(opts.fetch)d.window.fetch=opts.fetch;d.window.eval(script);return {d,w:d.window,r:d.window.document.querySelector('#nga-cards-host').shadowRoot};
}
function response(data){return {ok:true,url:'https://bbs.nga.cn/nuke.php?func=ucp&uid=66187805',headers:{get:()=> 'text/html; charset=utf-8'},arrayBuffer:async()=>new TextEncoder().encode(`<script>var __UCPUSER=${JSON.stringify(data)};window.profileScriptExecuted=true;</script>`).buffer};}
const settle=()=>new Promise(r=>setTimeout(r,15));
test('tap author or avatar shows native registration, rank, reputation, wealth and icon without a request',()=>{
 const data={66187805:user,__GROUPS:{39:['学徒']}};
 const {w,r}=page(post()+`<script type="text/plain">commonui.userInfo.setAll(${JSON.stringify(data)});</script>`,{fetch:()=>{throw new Error('native profile must not fetch');}});
 assert.equal(r.querySelector('.reader-author').firstChild.textContent,'Invisibl','empty duplicate native author does not hide the username');
 assert.match(r.querySelector('.reader-avatar img').src,/66187805_0.jpg\?92$/);
 r.querySelector('.reader-author').click();const panel=r.querySelector('.user-card');
 assert(panel.open);assert.match(panel.textContent,/2024\/09\/04/);assert.match(panel.textContent,/学徒/);assert.match(panel.textContent,/威望1/);assert.match(panel.textContent,/30 银币/);assert.match(panel.textContent,/7565/);
 assert.equal(panel.querySelector('.user-card-avatar img').src,r.querySelector('.reader-avatar img').src);
 panel.querySelector('.user-card-close').click();assert(!panel.open);assert.equal(r.activeElement,r.querySelector('.reader-author'));
 r.querySelector('.reader-avatar').click();assert(panel.open);w.close();
});
test('missing profiles load once on demand, cache data, and never execute fetched scripts',async()=>{
 let requests=0;const {w,r}=page(post(),{fetch:async()=>{requests++;return response({...user,group:'学徒'});}});
 assert.equal(requests,0);r.querySelector('.reader-author').click();await settle();
 assert.equal(requests,1);assert.match(r.querySelector('.user-card-details').textContent,/2024\/09\/04/);assert.equal(w.profileScriptExecuted,undefined);
 assert(r.querySelector('.reader-avatar img'));r.querySelector('.reader-avatar img').dispatchEvent(new w.Event('error'));assert.equal(r.querySelector('.reader-avatar img'),null);assert.equal(r.querySelector('.reader-avatar').textContent,'I');
 r.querySelector('.user-card-close').click();r.querySelector('.reader-author').click();await settle();assert.equal(requests,1);w.close();
});
test('closing during a profile request does not reopen the card; failures keep the original profile link',async()=>{
 let finish;const {w,r}=page(post(),{fetch:()=>new Promise(resolve=>finish=resolve)});
 r.querySelector('.reader-author').click();r.querySelector('.user-card-close').click();finish(response(user));await settle();assert(!r.querySelector('.user-card').open);w.close();
 const failed=page(post(),{fetch:async()=>{throw new Error('offline');}});failed.r.querySelector('.reader-author').click();await settle();
 assert.match(failed.r.querySelector('.user-card-status').textContent,/暂时无法/);assert.match(failed.r.querySelector('.user-card-link').href,/uid=66187805/);failed.w.close();
});
test('list author buttons preserve UID and open profiles; current account opens a card without leaving reading mode',async()=>{
 const list='<table id="topicrows"><tr><td class="c1">12</td><td class="c2"><a class="topic" href="/read.php?tid=1">测试标题</a></td><td class="c3"><a class="author" href="/nuke.php?func=ucp&uid=66187805">Invisibl</a></td></tr></table>';
 const {w,r}=page(list+`<script>var __CURRENT_UID=66187805,__CURRENT_UNAME='Invisibl';</script>`,{path:'thread.php?fid=-7',fetch:async()=>response(user)});
 r.querySelector('.person .author').click();await settle();assert.equal(r.querySelector('.user-card-uid').textContent,'UID 66187805');
 r.querySelector('.user-card-close').click();r.querySelector('.rt-fab').click();r.querySelector('.rt-account').click();await settle();
 assert(r.querySelector('.user-card').open);assert(!r.querySelector('.app').hidden);assert(r.querySelector('.rt-mask').hidden);assert(r.querySelector('.rt-account img'));w.close();
});
test('anonymous authors do not fetch another users profile or execute unsafe avatar URLs',async()=>{
 const {w,r}=page(post('', '匿名用户'),{fetch:()=>{throw new Error('anonymous must not fetch');}});
 r.querySelector('.reader-author').click();await settle();assert.match(r.querySelector('.user-card-status').textContent,/未提供/);assert(r.querySelector('.user-card-link').hidden);w.close();
 const bad={...user,avatar:'javascript:alert(1)'};
 const second=page(post()+`<script type="text/plain">commonui.userInfo.setAll(${JSON.stringify({66187805:bad})});</script>`);
 assert.equal(second.r.querySelector('.reader-avatar img'),null);second.w.close();
});
