const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const script = fs.readFileSync(__dirname + '/../dist/readscape-nga.user.js', 'utf8');
const download = 'https://nga-moyu-d8ghhi7acdf05dddc-1310402567.tcloudbaseapp.com/nga-moyu.zip';
const post = (floor, body) => `<table><tr><td><a>#${floor}</a><span id="postauthor${floor}">用户</span></td><td id="postcontainer${floor}"><a id="pid${floor}Anchor"></a><div id="postcontent${floor}" class="postcontent">${body}</div></td></tr></table>`;
// tid=47643164 的原站结构：警告框和悬停网址都用 urltip，与真实链接并列/嵌套。
const external = `<span class="apd">[</span><span class="urltip"><div>https:://<b>example.com</b>/file.zip</div><div>此网页不属于本网站，不保证其安全性</div><div><a href="${download}" onclick="window.hacked=true">继续访问</a><a href="javascript:void(0)">取消</a></div></span><a class="urlincontent" href="${download}" target="_blank" onclick="window.hacked=true"><span class="urltip">${download} </span><strong>nga-moyu</strong></a><span class="apd">]</span>`;
function setup(body) {
  const dom = new JSDOM(post(0, body), { url: 'https://bbs.nga.cn/read.php?tid=47643164', runScripts: 'dangerously' });
  dom.window.eval(script);
  return { dom, root: dom.window.document.querySelector('#nga-cards-host').shadowRoot };
}

test('真实 NGA 外链只保留标签与正确地址，去除警告框、悬停网址及括号', () => {
  const { dom, root } = setup(`下载压缩包${external}，解压得到文件夹`);
  try {
    const body = root.querySelector('.comment-content');
    assert.equal(body.textContent, '下载压缩包nga-moyu，解压得到文件夹');
    assert.equal(body.querySelectorAll('a').length, 1);
    const a = body.querySelector('a');
    assert.equal(a.href, download);
    assert.equal(a.title, download);
    assert.equal(a.target, '_blank');
    assert.equal(a.rel, 'noopener noreferrer');
    assert.equal(a.className, 'content-link external-link');
    assert.equal(a.querySelector('strong').textContent, 'nga-moyu');
    assert.equal(body.querySelector('[onclick], .urltip, .apd'), null);
    assert.equal(dom.window.hacked, undefined);
  } finally { dom.window.close(); }
});

test('站内相对链接、原始新窗口、空标签回退与无效地址', () => {
  const { dom, root } = setup('<a href="/read.php?tid=42&amp;page=2#pid9Anchor">站内帖子</a><a href="/nuke.php?uid=4" target="_blank">用户</a><a href="//example.com/path?q=1&amp;x=2"><span class="urltip">隐藏的标签</span></a><a>无地址</a><a href="">空地址</a><a href="javascript:alert(1)">脚本</a><a href="data:text/html,test">数据</a>');
  try {
    const body = root.querySelector('.comment-content'), links = body.querySelectorAll('a');
    assert.equal(links.length, 3);
    assert.equal(links[0].href, 'https://bbs.nga.cn/read.php?tid=42&page=2#pid9Anchor');
    assert.equal(links[0].target, '');
    assert.equal(links[0].className, 'content-link');
    assert.equal(links[1].target, '_blank');
    assert.equal(links[2].href, 'https://example.com/path?q=1&x=2');
    assert.equal(links[2].textContent, links[2].href);
    assert.match(body.textContent, /无地址空地址脚本数据$/);
  } finally { dom.window.close(); }
});

test('分页抓取和引用中的 NGA 外链使用相同的清理规则', async () => {
  const { dom, root } = setup('首楼');
  try {
    dom.window.TextDecoder = TextDecoder;
    dom.window.fetch = async url => ({ ok: true, url, headers: { get: () => 'text/html; charset=utf-8' }, arrayBuffer: async () => new TextEncoder().encode(post(20, `<div class="quote">${external}</div>${external}`)).buffer });
    root.querySelector('.load-next').click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const body = root.querySelector('[data-key="pid:20"] .comment-content');
    assert.equal(body.querySelectorAll('.content-link').length, 2);
    assert.equal(body.querySelector('.quoted-body').textContent, 'nga-moyu');
    assert.equal(body.querySelector('.quoted summary').textContent, '引用 · nga-moyu');
    assert.equal(body.querySelector('.urltip, .apd, [onclick]'), null);
    for (const a of body.querySelectorAll('.content-link')) assert.equal(a.href, download);
  } finally { dom.window.close(); }
});
