const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const fs=require('node:fs');
const bundle=fs.readFileSync(__dirname+'/../dist/readscape-nga.user.js','utf8');
const windows=[];afterEach(()=>{for(const w of windows.splice(0))w.close();});
const post=(body='正文',buttons='')=>`<table><tr><td><a id="postauthor1" href="/nuke.php?func=ucp&uid=66187805"></a></td><td id="postcontainer1"><a>#1</a><a id="pid875566191Anchor"></a><div id="postcontent1" class="postcontent">${body}</div>${buttons}</td></tr></table>`;
function page(html,init=()=>{}){const d=new JSDOM('<head></head><body>'+html+'</body>',{url:'https://bbs.nga.cn/read.php?tid=47653446',runScripts:'dangerously',virtualConsole:new VirtualConsole()});windows.push(d.window);d.window.__CURRENT_UID=42;init(d.window);if(d.window.unsafeWindow)d.window.unsafeWindow.__CURRENT_UID=42;d.window.eval(bundle);return {w:d.window,r:d.window.document.querySelector('#nga-cards-host').shadowRoot};}
test('reply and quote preserve original destinations including article/fid and bypass inline editors',()=>{
 const base='/post.php?&_newui&fid=510567&tid=47653446&pid=875566191&article=7&extra=keep';
 const {w,r}=page('<a href="/post.php?action=reply&_newui&fid=510567&tid=47653446">发表回复</a>'+post('正文',`<a href="${base}&action=reply" onclick="window.inlineEditor=true">回复</a><a href="${base}&action=quote" onclick="window.inlineEditor=true">引用</a>`));
 for(const [cls,action] of [['floor-reply','reply'],['floor-quote','quote']]){const a=r.querySelector('.'+cls),url=new URL(a.href);assert.equal(url.searchParams.get('action'),action);assert.equal(url.searchParams.get('article'),'7');assert.equal(url.searchParams.get('pid'),'875566191');assert.equal(url.searchParams.get('fid'),'510567');assert.equal(url.searchParams.get('extra'),'keep');assert(url.searchParams.has('_newui'));assert.equal(a.target,'_blank');assert.equal(a.rel,'noopener noreferrer');w.document.addEventListener('click',e=>e.preventDefault());a.click();}
 assert.equal(w.inlineEditor,undefined);assert(!r.querySelector('.app').hidden);
});
test('quote falls back to the native reply address and ignores links inside quoted content',()=>{
 const {r}=page(post('<a href="/post.php?action=quote&tid=47653446&pid=999">引用别人</a>', '<a href="/post.php?action=reply&_newui&fid=510567&tid=47653446&pid=875566191&article=2">回复</a>'));
 const url=new URL(r.querySelector('.floor-quote').href);assert.equal(url.searchParams.get('action'),'quote');assert.equal(url.searchParams.get('pid'),'875566191');assert.equal(url.searchParams.get('article'),'2');assert.equal(url.searchParams.get('fid'),'510567');
});
test('mobile reads isolated page userInfo and refreshes late profiles without remaining anonymous',async()=>{
 const {w,r}=page(post(),w=>{w.unsafeWindow={commonui:{userInfo:{users:{},groups:{39:['学徒']}}}};});
 assert.match(r.querySelector('.reader-author').textContent,/UID 66187805/);
 w.unsafeWindow.commonui.userInfo.users[66187805]={uid:66187805,username:'Invisibl',memberid:39,regdate:1725458735,avatar:'.a/66187805_1.jpg?33'};
 await new Promise(resolve=>setTimeout(resolve,1350));
 assert.equal(r.querySelector('.reader-author').textContent,'Invisibl');assert.match(r.querySelector('.reader-avatar img').src,/21d\/f1f\/003\/66187805_1.jpg\?33$/);
});
test('settings entry and exit animations follow the opener and closing can be cancelled by reopening',async()=>{
 const {r}=page(post());const sheet=r.querySelector('.rt-sheet'),mask=r.querySelector('.rt-mask');let animations=[];
 sheet.animate=(frames,options)=>{let complete;const animation={finished:new Promise(resolve=>complete=resolve),cancel:()=>{},complete};animations.push({frames,options,animation});return animation;};
 r.querySelector('.rt-fab').click();assert.equal(animations.length,1);assert.equal(animations[0].frames[0].opacity,0);
 r.querySelector('.rt-close').click();assert.equal(animations.length,2);assert(!mask.hidden);assert.equal(animations[1].frames.at(-1).opacity,0);
 r.querySelector('.rt-fab').click();animations[1].animation.complete();await Promise.resolve();assert(!mask.hidden,'an earlier close cannot hide a reopened sheet');
 r.querySelector('.rt-close').click();animations.at(-1).animation.complete();await Promise.resolve();assert(mask.hidden);
});

test('lazily generated native toolbars supply their own reply and quote URL templates',()=>{
 const {r}=page(post(),w=>{w.unsafeWindow={__CURRENT_FID:510567,commonui:{postBtn:{d:{7:{u:'/post.php?action=quote&_newui&fid={fid}&tid={tid}&pid={pid}&article={i}&nativeFlag=yes'},8:{u:'/post.php?action=reply&_newui&fid={fid}&tid={tid}&pid={pid}&article={i}&nativeFlag=yes'}}}}};});
 for(const cls of ['floor-reply','floor-quote'])assert.equal(new URL(r.querySelector('.'+cls).href).searchParams.get('nativeFlag'),'yes');
});
