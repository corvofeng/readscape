const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const script=fs.readFileSync(__dirname+'/../dist/readscape-nga.user.js','utf8');
const post=floor=>`<table><tr><td><a>#${floor}</a></td><td id="postcontainer${floor}"><a id="pid${floor}Anchor"></a><div id="postcontent${floor}">正文 ${floor}</div></td></tr></table>`;
const pager=next=>`<div id="pagebtop">${next?`<a href="/read.php?tid=123&page=${next}">后页</a>`:''}</div>`;
function setup(html,url='https://bbs.nga.cn/read.php?tid=123'){
 const dom=new JSDOM(html,{url,runScripts:'dangerously'});dom.window.TextDecoder=TextDecoder;dom.window.eval(script);
 return {dom,root:dom.window.document.querySelector('#nga-cards-host').shadowRoot};
}
test('单页帖子直接显示到底，不发送多余请求',()=>{
 const {dom,root}=setup(pager()+post(0)+post(1));
 try{let calls=0;dom.window.fetch=()=>{calls++;};assert(root.querySelector('.load-next').hidden);assert(!root.querySelector('.reader-end').hidden);root.querySelector('.load-next').click();assert.equal(calls,0);}finally{dom.window.close();}
});
test('多页帖子加载到最后一页后隐藏按钮，末页直接打开也显示到底',async()=>{
 const {dom,root}=setup(pager(2)+post(0));
 try{
  let calls=0;dom.window.fetch=async url=>{calls++;return {ok:true,url,headers:{get:()=>''},arrayBuffer:async()=>new TextEncoder().encode(pager()+post(20)).buffer};};
  assert(!root.querySelector('.load-next').hidden);assert(root.querySelector('.reader-end').hidden);
  root.querySelector('.load-next').click();await new Promise(r=>setTimeout(r,30));
  assert.equal(calls,1);assert.equal(root.querySelectorAll('.comment').length,2);assert(root.querySelector('.load-next').hidden);assert(!root.querySelector('.reader-end').hidden);
 }finally{dom.window.close();}
 const last=setup(`<div id="pagebtop"><a href="/read.php?tid=123&page=1">前页</a><a class="invert">2</a></div>`+post(20),'https://bbs.nga.cn/read.php?tid=123&page=2');
 try{assert(last.root.querySelector('.load-next').hidden);}finally{last.dom.window.close();}
});
test('原站晚到的分页信息会更新按钮，不依赖正文变化',async()=>{
 const {dom,root}=setup(pager()+post(0));
 try{
  assert(root.querySelector('.load-next').hidden);
  dom.window.document.querySelector('#pagebtop').innerHTML='<a href="/read.php?tid=123&page=2">后页</a>';
  await new Promise(r=>setTimeout(r,300));assert(!root.querySelector('.load-next').hidden);assert(root.querySelector('.reader-end').hidden);
 }finally{dom.window.close();}
});
test('没有分页信息时保留加载入口，其他帖子链接不会误判下一页',()=>{
 const unknown=setup(post(0));try{assert(!unknown.root.querySelector('.load-next').hidden);}finally{unknown.dom.window.close();}
 const unrelated=setup('<div id="pagebtop"><a href="/read.php?tid=456&page=2">另一帖</a></div>'+post(0));try{assert(unrelated.root.querySelector('.load-next').hidden);}finally{unrelated.dom.window.close();}
});

test('翻页加载和失败重试保留已有页面节点与展开的回复串',async()=>{
 const reply=post(2).replace('正文 2','<div class="quote"><a href="/read.php?tid=123&topid=1">引用</a>正文 1</div>回复');
 const {dom,root}=setup(pager(2)+post(0)+post(1)+reply);
 try{
  root.querySelector('[data-pref=groupReplies]').click();
  const section=root.querySelector('.reader-page'),thread=root.querySelector('.thread'),card=root.querySelector('[data-key="pid:1"]'),app=root.querySelector('.app');
  thread.open=true;app.scrollTop=640;
  const removed=[];
  const observer=new dom.window.MutationObserver(changes=>{for(const change of changes)removed.push(...change.removedNodes);});
  observer.observe(root.querySelector('.reader-stream'),{childList:true,subtree:true});
  let resolveFetch;
  dom.window.fetch=()=>new Promise(resolve=>{resolveFetch=resolve;});
  root.querySelector('.load-next').click();await new Promise(r=>setTimeout(r,20));
  assert.equal(root.querySelector('.reader-page'),section);assert.equal(root.querySelector('.thread'),thread);assert(thread.open);assert.equal(app.scrollTop,640);
  resolveFetch({ok:false,status:503});await new Promise(r=>setTimeout(r,20));
  assert(thread.open);assert.equal(app.scrollTop,640);
  dom.window.fetch=async url=>({ok:true,url,headers:{get:()=>''},arrayBuffer:async()=>new TextEncoder().encode(pager(3)+post(20)).buffer});
  root.querySelector('.load-next').click();await new Promise(r=>setTimeout(r,20));
  assert.equal(root.querySelectorAll('.reader-page').length,2);assert.equal(root.querySelector('.reader-page'),section);
  assert.equal(root.querySelector('[data-key="pid:1"]'),card);assert.equal(root.querySelector('.thread'),thread);assert(thread.open);assert.equal(app.scrollTop,640);
  assert(!removed.includes(section));assert(!removed.includes(thread));assert(!removed.includes(card));
  dom.window.document.querySelector('#pagebtop').append(dom.window.document.createTextNode('更新'));
  await new Promise(r=>setTimeout(r,300));
  assert.equal(root.querySelector('.thread'),thread);assert(thread.open);assert.equal(app.scrollTop,640);
  assert(!removed.includes(section));assert(!removed.includes(thread));assert(!removed.includes(card));observer.disconnect();
 }finally{dom.window.close();}
});

test('后台更新不会再次跳回 URL 指定的原楼',async()=>{
 const {dom,root}=setup(pager(2)+post(1),'https://bbs.nga.cn/read.php?tid=123#pid1Anchor');
 try{
  let focuses=0;dom.window.HTMLElement.prototype.scrollIntoView=()=>{focuses++;};
  await new Promise(r=>setTimeout(r,70));assert.equal(focuses,1);
  dom.window.document.querySelector('#postcontent1').append('晚到的内容');
  await new Promise(r=>setTimeout(r,350));
  assert(root.querySelector('.comment-content').textContent.includes('晚到的内容'));assert.equal(focuses,1);
 }finally{dom.window.close();}
});
