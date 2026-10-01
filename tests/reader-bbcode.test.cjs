const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const script=fs.readFileSync(__dirname+'/../dist/readscape-nga.user.js','utf8');
const post=(floor,body,pid=1000+floor)=>`<table><tr id="post1strow${floor}"><td><a class="author" href="/nuke.php?func=ucp&uid=123">作者</a></td><td id="postcontainer${floor}"><a id="pid${pid}Anchor"></a><a name="l${floor}"></a><span id="postcontent${floor}" class="postcontent ubbcode">${body}</span></td></tr></table>`;
const metadata=(total,page)=>`<div id="pagebtop"></div><script>var __PAGE = {0:'/read.php?tid=123',1:${total},2:${page},3:20};</script>`;
const wait=()=>new Promise(r=>setTimeout(r,60));
function setup(html,url='https://bbs.nga.cn/read.php?tid=123') {
 const dom=new JSDOM(html,{url,runScripts:'outside-only'}); dom.window.TextDecoder=TextDecoder;
 dom.window.HTMLElement.prototype.scrollIntoView=function(){this.dataset.scrolled='true';};
 dom.window.ubbcode={smiles:{ac:{哭笑:'ac15.png'}}}; dom.window.eval(script);
 return {dom,root:dom.window.document.querySelector('#nga-cards-host').shadowRoot};
}
function response(url,html){return {ok:true,url,headers:{get:()=>''},arrayBuffer:async()=>new TextEncoder().encode(html).buffer};}
test('下一页转换跨 HTML 换行的引用、Reply to、表情和图片，不执行正文代码',async()=>{
 const {dom,root}=setup(metadata(60,1)+post(0,'首楼')+post(1,'原楼'));
 try {
  dom.window.fetch=async url=>response(url,metadata(60,2)+post(20,'[b]Reply to [pid=1001,123,1]Reply[/pid] Post by [uid=123]作者[/uid][/b]正文[s:ac:哭笑]')+post(21,'[quote][pid=1001,123,1]Reply[/pid] [b]作者[/b]<br><br>引用内容[/quote]<br>回复 [img]./mon_202610/test.jpg[/img]<script>window.BAD=1</script>'));
  root.querySelector('.load-next').click(); await wait();
  const reply=root.querySelector('[data-key="pid:1020"]');
  assert.equal(reply.querySelector('.floor').textContent,'#20');
  assert(reply.querySelector('.reply-rel.context')); assert(reply.querySelector('.emoji').src.endsWith('/ac15.png'));
  const quote=root.querySelector('[data-key="pid:1021"]');
  assert(quote.querySelector('.quoted-body').textContent.includes('引用内容'));
  assert(!quote.querySelector('.comment-content').textContent.includes('[quote]'));
  assert(quote.querySelector('.attachment').href.endsWith('/attachments/mon_202610/test.jpg'));
  assert.equal(dom.window.BAD,undefined); assert(!root.querySelector('.load-next').hidden);
  quote.querySelector('.context').click(); await wait(); assert.equal(root.querySelector('[data-key="pid:1001"]').dataset.scrolled,'true');
 } finally {dom.window.close();}
});
test('跨页引用按需加载原楼并缓存，再次回查无需请求，下一页仍沿原阅读位置加载',async()=>{
 const {dom,root}=setup(metadata(100,3)+post(40,'[quote][pid=1001,123,1]Reply[/pid]原楼[/quote]'),'https://bbs.nga.cn/read.php?tid=123&page=3');
 try {
  const requests=[]; dom.window.fetch=async url=>{const page=Number(new URL(url).searchParams.get('page'));requests.push(page);return response(url,metadata(100,page)+post(page===1?1:60,'目标内容'));};
  root.querySelector('.context').click(); await wait();
  assert.deepEqual(requests,[1]); assert.equal(root.querySelector('[data-key="pid:1001"]').dataset.scrolled,'true');
  root.querySelector('[data-key="pid:1040"] .context').click(); await wait(); assert.deepEqual(requests,[1]);
  root.querySelector('.load-next').click(); await wait(); assert.deepEqual(requests,[1,4]);
 } finally {dom.window.close();}
});
test('引用缺页码可回查第 500 条评论，且分页元数据识别末页',async()=>{
 const {dom,root}=setup(metadata(520,27)+post(520,'[quote][pid=1500,123]Reply[/pid]引用[/quote]'),'https://bbs.nga.cn/read.php?tid=123&page=27');
 try {
  const requests=[]; dom.window.fetch=async url=>{const page=Number(new URL(url).searchParams.get('page'));requests.push(page);return response(url,metadata(520,page)+post((page-1)*20,'楼层'));};
  root.querySelector('.context').click(); await new Promise(r=>setTimeout(r,250));
  assert.equal(requests.length,26); assert.equal(requests.at(-1),26); assert.equal(root.querySelector('[data-key="pid:1500"]').dataset.scrolled,'true');
  assert(root.querySelector('.load-next').hidden);
 } finally {dom.window.close();}
});
test('危险 BBCode 链接不会执行，code 中的 BBCode 保留为示例文本',()=>{
 const {dom,root}=setup(post(0,'[url=javascript:alert(1)]危险[/url][img]javascript:alert(2)[/img][code][b]literal[/b][/code]<pre>[quote]example[/quote]</pre>'));
 try {assert(!root.querySelector('a[href^="javascript:"]'));assert(!root.querySelector('img[src^="javascript:"]'));assert.equal(root.querySelector('.comment-content code').textContent,'[b]literal[/b]');assert.equal(root.querySelector('.comment-content pre').textContent,'[quote]example[/quote]');} finally {dom.window.close();}
});
