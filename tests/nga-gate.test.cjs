const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('node:fs');
const bundle = fs.readFileSync(__dirname + '/../dist/readscape-nga.user.js', 'utf8');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const GATE_PASS = '1791532420_lpua0p';

// NGA 的闸门页：正文是 (ERROR:15)，通行证写在它自己的内联脚本里。
const gateHTML = () => `<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>访客不能直接访问</title></head><body>(ERROR:<!--msgcodestart-->15<!--msgcodeend-->) <span>&gt;</span> 访客不能直接访问<script>
f = function(){document.cookie = 'guestJs=${GATE_PASS};domain='+d+';path=/;expires='+x.toUTCString()}
</script><a href="javascript:void(0)" onclick="g()">如不能自动跳转 可点此链接</a></body></html>`;

const postHTML = () => `<!DOCTYPE html><html><head><title>测试帖子标题 NGA玩家社区</title></head><body>
  <table><tr id="post1strow0"><td><a class="author" href="/nuke.php?uid=1">测试作者</a></td>
  <td id="postcontainer0"><h3 id="postsubject0">测试帖子标题</h3>
  <span id="postcontent0" class="postcontent">这是帖子正文内容</span></td></tr></table>
</body></html>`;

const LIST_HTML = `<table id="topicrows"><tr class="topicrow"><td class="c1">18</td>
  <td class="c2"><a class="topic" href="/read.php?tid=100">帖子100</a></td>
  <td class="c3"><a class="author">作者1</a></td></tr></table>`;

function createPage(fetcher) {
  const d = new JSDOM('<head></head><body>' + LIST_HTML + '</body>', {
    url: 'https://bbs.nga.cn/thread.php?fid=1',
    runScripts: 'dangerously',
    virtualConsole: new VirtualConsole()
  });
  const w = d.window;
  w.TextDecoder = TextDecoder;
  w.TextEncoder = TextEncoder;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.fetch = fetcher;
  w.eval(bundle);
  return { d, w, root: w.document.getElementById('nga-cards-host').shadowRoot };
}

const openCard = root => root.querySelector('[data-tid="100"] .cover').click();

test('后台 fetch 撞上访客闸门时，捡回 guestJs 通行证换 rand 重试并正常打开帖子', async () => {
  const urls = [];
  const { d, w, root } = createPage(async (url) => {
    urls.push(String(url));
    const first = urls.filter(u => /read\.php/.test(u)).length === 1;
    return { ok: true, url: String(url), headers: { get: () => '' }, text: async () => (first ? gateHTML() : postHTML()) };
  });
  try {
    openCard(root);
    await sleep(1500);

    const readURLs = urls.filter(u => /read\.php/.test(u));
    assert.equal(readURLs.length, 2, '通行证重试一次即可，不应反复请求');
    assert.ok(!/[?&]rand=/.test(readURLs[0]), '首次请求保持原链接');
    assert.match(readURLs[1], /[?&]rand=\d+/, '重试要换 rand 绕开缓存');
    assert.match(readURLs[1], /tid=100/, '重试仍是同一帖子');
    assert.match(w.document.cookie, new RegExp(`guestJs=${GATE_PASS}`), '通行证应写回 cookie');

    const reader = root.querySelector('.app.reader');
    assert(reader && !reader.hidden, '闸门自愈后阅读器应直接呈现内容');
    assert.match(reader.textContent, /这是帖子正文内容/);
    assert.equal(w.document.querySelector('iframe[data-readscape-reader]'), null, '自愈成功不需要整页跳转');
    assert.equal(root.querySelector('.spa-loading-notice'), null, '加载提示应已收回');
  } finally {
    d.window.close();
  }
});

test('闸门页里捡不到通行证时不重试，交回原有整页流程', async () => {
  const urls = [];
  const { d, w, root } = createPage(async (url) => {
    urls.push(String(url));
    return { ok: true, url: String(url), headers: { get: () => '' }, text: async () => '<title>访客不能直接访问</title>' };
  });
  try {
    openCard(root);
    await sleep(600);
    assert.equal(urls.filter(u => /read\.php/.test(u)).length, 1, '没有通行证就不要盲试');
    assert(!root.querySelector('.app.reader:not([hidden])'), '仍被闸门时不应伪造出阅读器');
    assert(!root.querySelector('.spa-loading-notice'), '加载提示不应残留');
  } finally {
    d.window.close();
  }
});

test('同一目标反复撞闸门时按配额停下，不会形成重试循环', async () => {
  const urls = [];
  const { d, w, root } = createPage(async (url) => {
    urls.push(String(url));
    return { ok: true, url: String(url), headers: { get: () => '' }, text: async () => gateHTML() };
  });
  try {
    openCard(root);
    await sleep(2500);
    const firstRound = urls.filter(u => /read\.php/.test(u)).length;
    assert.equal(firstRound, 3, '两分钟配额内最多自愈两次（共三次请求）');
    assert(!root.querySelector('.app.reader:not([hidden])'), '闸门始终没放行时不打开阅读器');

    openCard(root);
    await sleep(600);
    assert.equal(urls.filter(u => /read\.php/.test(u)).length, firstRound + 1, '配额用尽后只走一次请求');
  } finally {
    d.window.close();
  }
});

test('闸门页带 403 状态时也按通行证自愈，不把 4xx 直接当失败', async () => {
  const urls = [];
  const { d, w, root } = createPage(async (url) => {
    urls.push(String(url));
    const blocked = urls.filter(u => /read\.php/.test(u)).length === 1;
    return blocked
      ? { ok: false, status: 403, url: String(url), headers: { get: () => '' }, text: async () => gateHTML() }
      : { ok: true, url: String(url), headers: { get: () => '' }, text: async () => postHTML() };
  });
  try {
    openCard(root);
    await sleep(1500);
    const readURLs = urls.filter(u => /read\.php/.test(u));
    assert.equal(readURLs.length, 2);
    assert.match(readURLs[1], /[?&]rand=\d+/);
    const reader = root.querySelector('.app.reader');
    assert(reader && !reader.hidden, '403 闸门放行后仍应直接打开阅读器');
    assert.match(reader.textContent, /这是帖子正文内容/);
  } finally {
    d.window.close();
  }
});

test('真正的 HTTP 错误仍然抛出，不会被误判成闸门', async () => {
  const urls = [];
  const { d, w, root } = createPage(async (url) => {
    urls.push(String(url));
    return { ok: false, status: 500, url: String(url), headers: { get: () => '' }, text: async () => 'Server Error' };
  });
  try {
    openCard(root);
    await sleep(400);
    assert.equal(urls.filter(u => /read\.php/.test(u)).length, 1, '非闸门错误不重试');
    assert(!root.querySelector('.app.reader:not([hidden])'));
    assert(!root.querySelector('.spa-loading-notice'), '失败后不留加载提示');
  } finally {
    d.window.close();
  }
});

test('阅读器翻页撞上闸门时同样自愈，第 2 页楼层照常追加', async () => {
  const row = (floor, pid, body) => `<table><tr id="post1strow${floor}"><td><a id="postauthor${floor}" class="author" href="/nuke.php?uid=${floor}">用户${floor}</a></td><td id="postcontainer${floor}"><a id="pid${pid}Anchor"></a><div id="postInfo${floor}"><span id="postdate${floor}">2026-10-01 13:00</span></div><h3 id="postsubject${floor}">${floor === 0 ? '测试帖子' : ''}</h3><span id="postcontent${floor}" class="postcontent">${body}</span></td></tr></table>`;
  const firstPage = `<title>测试帖子 NGA玩家社区</title><div id="pagebtop"><a class="invert">1</a><a href="/read.php?tid=47651896&page=2">后页</a></div>${row(0, 0, '这是首楼。')}${row(1, 1001, '第一页的评论')}`;
  const urls = [];
  let page2Served = 0;
  const d = new JSDOM(firstPage, { url: 'https://bbs.nga.cn/read.php?tid=47651896', runScripts: 'dangerously', virtualConsole: new VirtualConsole() });
  const w = d.window;
  w.TextDecoder = TextDecoder;
  w.TextEncoder = TextEncoder;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.fetch = async (url) => {
    url = String(url);
    urls.push(url);
    const number = new URL(url).searchParams.get('page');
    const html = number === '2' && ++page2Served > 1
      ? row(20, 2001, '第 2 页正文') + row(21, 2002, '第 2 页另一楼')
      : number === '2' ? gateHTML() : firstPage;
    return { ok: true, url, headers: { get: () => 'text/html; charset=utf-8' }, arrayBuffer: async () => new TextEncoder().encode(html).buffer };
  };
  try {
    w.eval(bundle);
    const root = w.document.querySelector('#nga-cards-host').shadowRoot;
    assert.equal(root.querySelectorAll('.comment').length, 2);
    root.querySelector('.load-next').click();
    await sleep(1500);
    const page2URLs = urls.filter(u => /page=2/.test(u));
    assert.equal(page2URLs.length, 2, '翻页被闸门挡住后重试一次');
    assert.ok(!/[?&]rand=/.test(page2URLs[0]));
    assert.match(page2URLs[1], /[?&]rand=\d+/);
    assert.match(w.document.cookie, new RegExp(`guestJs=${GATE_PASS}`));
    assert.equal(root.querySelectorAll('.comment').length, 4, '第 2 页楼层应接在自愈之后');
    assert.match(root.querySelector('.reader-status').textContent, /已加载第 2 页/);
  } finally {
    d.window.close();
  }
});
