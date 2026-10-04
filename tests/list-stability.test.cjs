const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const fs = require('node:fs');
const bundle = fs.readFileSync(__dirname + '/../dist/readscape-nga.user.js', 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 25));
async function setup({ factory = new IDBFactory(), savedScroll, fetcher, automatic = false, clock, spaReader = false } = {}) {
  const body = '<table>' + [1, 2, 3, 4].map(tid => `<tr><td class="c2"><a class="topic" href="/read.php?tid=${tid}">帖子 ${tid}</a></td></tr>`).join('') + '</table>';
  const d = new JSDOM('<head></head><body>' + body + '</body>', { url: 'https://bbs.nga.cn/thread.php?fid=1', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const w = d.window;
  w.indexedDB = factory; w.TextDecoder = TextDecoder;
  if (fetcher) w.fetch = fetcher;
  if (clock) {
    const timeout = w.setTimeout.bind(w), clear = w.clearTimeout.bind(w);
    clock.queue = new Map(); let id = -1;
    w.setTimeout = (fn, delay) => { if (delay !== 10000) return timeout(fn, delay); clock.queue.set(id, fn); return id--; };
    w.clearTimeout = key => { if (key < 0) clock.queue.delete(key); else clear(key); };
    clock.tick = async () => { const entry = clock.queue.entries().next().value; assert(entry, 'automatic refresh is scheduled'); clock.queue.delete(entry[0]); await entry[1](); };
  }
  const channels = [];
  w.BroadcastChannel = class {
    constructor() { channels.push(this); }
    postMessage(data) { for (const channel of channels) if (channel !== this) channel.onmessage?.({ data }); }
    close() {}
  };
  if (savedScroll) {
    w.performance.getEntriesByType = () => [{ type: 'reload' }];
    w.sessionStorage.setItem('nga-cards-v1-scroll-https://bbs.nga.cn/thread.php?fid=1#1', JSON.stringify({ y: savedScroll, at: Date.now() }));
  }
  w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  w.scrollTo = ({ top }) => { w.scrollY = top; };
  let resize;
  w.ResizeObserver = class { constructor(fn) { resize = fn; } observe() {} unobserve() {} disconnect() {} };
  const computed = w.getComputedStyle.bind(w);
  w.getComputedStyle = el => el.classList.contains('grid') ? { gridTemplateColumns: '180px 180px' } : computed(el);
  w.localStorage.setItem('nga-cards-v1', JSON.stringify({ enabled: true, autoListRefresh: automatic, spaReader }));
 w.eval(bundle);
  for (let i = 0; i < 100 && w.document.getElementById('nga-cards-host').shadowRoot.querySelector('.grid').getAttribute('aria-busy') === 'true'; i++) await tick();
  const root = w.document.getElementById('nga-cards-host').shadowRoot;
  return { w, root, resize: () => resize() };
}
test('masonry keeps columns and card identities when a card height changes', async () => {
  const { w, root, resize } = await setup();
  try {
    const cards = [...root.querySelectorAll('.card')];
    const heights = [200, 300, 180, 240];
    cards.forEach((card, i) => Object.defineProperty(card, 'offsetHeight', { get: () => heights[i] }));
    resize();
    assert.deepEqual(cards.map(c => c.style.gridColumn), ['1', '2', '1', '2']);
    assert.deepEqual(cards.map(c => c.style.gridRowStart), ['1', '1', '56', '81']);
    heights[0] = 500; resize();
    assert.deepEqual(cards.map(c => c.style.gridColumn), ['1', '2', '1', '2']);
    assert.equal(cards[2].style.gridRowStart, '131');
    assert.equal(cards[3].style.gridRowStart, '81');
    root.querySelector('.save').click(); await tick();
    assert.deepEqual([...root.querySelectorAll('.card')], cards);
  } finally { w.close(); }
});
test('clicks focus without scrolling or retaining an old target', async () => {
  const { w, root } = await setup();
  try {
    const cards = [...root.querySelectorAll('.card')], first = cards[0].querySelector('.cover'), second = cards[1].querySelector('.cover');
    root.querySelector('.app').dispatchEvent(new w.Event('touchstart', { bubbles: true }));
    let focus;
    second.focus = options => { focus = options; };
    const down = new w.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    second.dispatchEvent(down);
    assert(down.defaultPrevented); assert.equal(focus.preventScroll, true);
    first.dispatchEvent(new w.Event('pointerdown', { bubbles: true, composed: true }));
    first.dispatchEvent(new w.Event('pointercancel', { bubbles: true, composed: true }));
    second.dispatchEvent(new w.MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
    assert.match(w.document.querySelector('iframe[data-readscape-reader]').src, /tid=2$/);
  } finally { w.close(); }
});

test('manual mode keeps new reader covers queued and shows them on the next visit', async () => {
  const factory = new IDBFactory(), { w, root } = await setup({ factory });
  let cache, next;
  try {
    await tick();
    w.eval(fs.readFileSync(__dirname + '/../src/core/post-cache.js', 'utf8') + ';window.createPostCache = createPostCache;');
    cache = w.createPostCache({ context: w, key: 'nga-cards-v1' });
    root.querySelector('.app').dispatchEvent(new w.Event('touchstart', { bubbles: true }));
    const cards = [...root.querySelectorAll('.card')];
    const rows = cards.map(card => card.style.gridRowStart);
    await cache.saveCover('1', 'https://img.nga.cn/new.png', { coverW: 640, coverH: 1407 });
    await tick();
    assert.equal(cards[0].querySelector('.cached-cover-image'), null);
    assert.deepEqual(cards.map(card => card.style.gridRowStart), rows);
    next = await setup({ factory });
    for (let i = 0; i < 50 && !next.root.querySelector('.cached-cover-image'); i++) await tick();
    assert.equal(next.root.querySelector('.cached-cover-image').src, 'https://img.nga.cn/new.png');
  } finally { cache?.close(); w.close(); next?.w.close(); }
});
test('user scrolling cancels delayed restoration instead of jumping back later', async () => {
  const { w, root } = await setup({ savedScroll: 900 });
  try {
    root.querySelector('.app').dispatchEvent(new w.Event('wheel', { bubbles: true }));
    w.scrollY = 300;
    Object.defineProperty(w.document.documentElement, 'scrollHeight', { value: 3000 });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(w.scrollY, 300);
  } finally { w.close(); }
});

function response(url, ids, title = '最新帖子') {
  const html = '<table>' + ids.map(id => `<tr><td class="c2"><a class="topic" href="/read.php?tid=${id}">${title} ${id}</a></td><td class="c1">120</td></tr>`).join('') + '</table>';
  return { ok: true, url, headers: { get: () => '' }, arrayBuffer: async () => new TextEncoder().encode(html).buffer };
}
async function seeded() {
  const factory = new IDBFactory(), seed = await setup({ factory });
  seed.w.eval(fs.readFileSync(__dirname + '/../src/core/post-cache.js', 'utf8') + ';window.createPostCache = createPostCache;');
  const cache = seed.w.createPostCache({ context: seed.w, key: 'nga-cards-v1' });
  const url = 'https://bbs.nga.cn/thread.php?fid=1';
  const items = [1,2,3,4].map(id => ({ tid: String(id), title: `缓存帖子 ${id}`, author: '作者', time: '', replies: 0, url: `https://bbs.nga.cn/read.php?tid=${id}`, latest: '', lastAccess: Date.now() }));
  await cache.saveListPages(url, new Map([[1, { url, items, next: null }]]));
  cache.close(); seed.w.close(); return factory;
}
test('startup checks the network before announcing changes and ignores time, order and pagination alone', async () => {
  const factory = new IDBFactory(), seed = await setup({ factory });
  await tick(); seed.w.close();
  let finish, calls = 0, options;
  const { w, root } = await setup({ factory, fetcher: (url, init) => {
    calls++; options = init;
    return new Promise(resolve => { finish = () => {
      const html = '<script>var __PAGE = {1:0,2:1,3:35};</script><table>' + [4,3,2,1].map(id => `<tr><td class="c2"><a class="topic" href="/read.php?tid=${id}">帖子 ${id}</a></td><td>2 分钟前</td></tr>`).join('') + '</table>';
      resolve({ ok: true, url, headers: { get: () => '' }, arrayBuffer: async () => new TextEncoder().encode(html).buffer });
    }; });
  } });
  try {
    assert.equal(calls, 1); assert.equal(options.cache, 'no-cache');
    assert.equal(root.querySelector('.list-refresh').hidden, true);
    assert(!root.querySelector('.list-refresh-bar').classList.contains('has-update'));
    finish(); await tick();
    assert.equal(root.querySelector('.list-refresh-status').textContent, '列表已是最新');
    assert.equal(root.querySelector('.list-refresh').hidden, true);
    assert(root.querySelector('.list-load').hidden);
    assert.deepEqual([...root.querySelectorAll('.card')].map(card => card.dataset.tid), ['1','2','3','4']);
  } finally { w.close(); }
});
test('native DOM changes after interaction must be confirmed by a request', async () => {
  let calls = 0, finish;
  const { w, root } = await setup({ fetcher: url => {
    calls++;
    return new Promise(resolve => { finish = () => {
      const html = '<table>' + [1,2,3,4].map(id => `<tr><td class="c2"><a class="topic" href="/read.php?tid=${id}">帖子 ${id}</a></td></tr>`).join('') + '</table>';
      resolve({ ok: true, url, headers: { get: () => '' }, arrayBuffer: async () => new TextEncoder().encode(html).buffer });
    }; });
  } });
  try {
    root.querySelector('.app').dispatchEvent(new w.Event('wheel', { bubbles: true }));
    w.document.querySelector('a.topic').textContent = '原页面临时变化';
    await wait(300);
    assert.equal(calls, 1); assert.equal(root.querySelector('.list-refresh').hidden, true);
    finish(); await tick();
    assert.equal(root.querySelector('.list-refresh-status').textContent, '列表已是最新');
    assert.equal(root.querySelector('.title').textContent, '帖子 1');
  } finally { w.close(); }
});
test('cached first page renders before the network and background updates wait for explicit application', async () => {
  const factory = await seeded(); let resolve, calls = 0;
  const { w, root } = await setup({ factory, fetcher: url => { calls++; return new Promise(done => { resolve = () => done(response(url, [5,1,2,3,4])); }); } });
  try {
    assert.equal(calls, 1);
    const card = root.querySelector('[data-tid="1"]'), cover = card.querySelector('.cover'), favorite = card.querySelector('.save');
    assert.equal(card.querySelector('.title').textContent, '缓存帖子 1');
    w.scrollY = 300; root.querySelector('.app').dispatchEvent(new w.Event('touchstart', { bubbles: true }));
    resolve(); await tick();
    assert.equal(root.querySelectorAll('.card').length, 4);
    assert.equal(card.querySelector('.title').textContent, '缓存帖子 1');
    assert.equal(root.querySelector('.list-refresh').hidden, false);
    assert.equal(w.scrollY, 300);
    root.querySelector('.list-refresh').click();
    assert.equal(root.querySelectorAll('.card').length, 5);
    assert.equal(root.querySelector('[data-tid="1"]'), card);
    assert.equal(card.querySelector('.cover'), cover); assert.equal(card.querySelector('.save'), favorite);
    assert.equal(card.querySelector('.title').textContent, '最新帖子 1');
    assert.equal(w.scrollY, 300); assert.equal(root.querySelector('.list-refresh').hidden, true);
    favorite.click();
    assert.equal(favorite.getAttribute('aria-pressed'), 'true');
    assert(favorite.classList.contains('save-pop'));
  } finally { w.close(); }
});
test('failed background refresh preserves cached cards and offers a working retry', async () => {
  const factory = await seeded(); let calls = 0;
  const { w, root } = await setup({ factory, fetcher: async url => { if (++calls === 1) throw new Error('offline'); return response(url, [1,2,3,4], '重试成功'); } });
  try {
    await tick(); const card = root.querySelector('.card');
    assert.match(root.querySelector('.list-refresh-status').textContent, /更新失败/);
    assert.equal(root.querySelector('.list-refresh').textContent, '重试更新');
    root.querySelector('.list-refresh').click(); await tick();
    assert.equal(calls, 2); assert.equal(root.querySelector('.card'), card);
    assert.equal(card.querySelector('.title').textContent, '缓存帖子 1');
    root.querySelector('.list-refresh').click();
    assert.equal(card.querySelector('.title').textContent, '重试成功 1');
  } finally { w.close(); }
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function pointer(w, target, type, id = 1) {
  const event = new w.Event(type, { bubbles: true, composed: true }); Object.defineProperty(event, 'pointerId', { value: id }); target.dispatchEvent(event);
}
function touch(w, target, type, x, y) {
  const event = new w.Event(type, { bubbles: true, composed: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: x, clientY: y }] }); target.dispatchEvent(event); return event;
}
test('10-second automatic refresh defers geometry throughout a press and opening a post', async () => {
  const clock = {}, { w, root } = await setup({ automatic: true, clock, fetcher: async url => response(url, [5,1,2,3,4]) });
  try {
    w.scrollY = 300; const card = root.querySelector('.card'), cover = card.querySelector('.cover');
    pointer(w, cover, 'pointerdown'); await clock.tick(); await wait(800);
    assert.equal(card.querySelector('.title').textContent, '帖子 1');
    assert.equal(root.querySelectorAll('.card').length, 4);
    pointer(w, cover, 'pointerup'); cover.click(); await wait(800);
    assert.match(w.document.querySelector('iframe[data-readscape-reader]').src, /tid=1$/);
    assert.equal(card.querySelector('.title').textContent, '帖子 1');
    w.document.querySelector('[role=status] button').click(); await wait(1500);
    assert.equal(card.querySelector('.title').textContent, '最新帖子 1');
    assert.deepEqual([...root.querySelectorAll('.card')].map(c => c.dataset.tid), ['1','2','3','4','5']);
    assert.equal(root.querySelector('[data-tid="1"]'), card);
    assert.equal(w.scrollY, 300);
  } finally { w.close(); }
});
test('automatic refresh pauses in hidden pages and its switch persists and stops polling', async () => {
  let calls = 0; const clock = {}, { w, root } = await setup({ automatic: true, clock, fetcher: async url => { calls++; return response(url, [1,2,3,4]); } });
  try {
    Object.defineProperty(w.document, 'hidden', { configurable: true, value: true });
    await clock.tick(); assert.equal(calls, 0);
    Object.defineProperty(w.document, 'hidden', { configurable: true, value: false });
    const setting = root.querySelector('[data-pref=autoListRefresh]'); assert(setting.checked);
    setting.checked = false; setting.dispatchEvent(new w.Event('change'));
    assert.equal(JSON.parse(w.localStorage.getItem('nga-cards-v1')).autoListRefresh, false);
    assert.equal(clock.queue.size, 0);
    setting.checked = true; setting.dispatchEvent(new w.Event('change')); await clock.tick();
    assert.equal(calls, 1);
  } finally { w.close(); }
});
test('pull-to-refresh requires the top, vertical threshold and release, and works with polling disabled', async () => {
  let calls = 0;
  const { w, root } = await setup({ fetcher: async url => { calls++; return response(url, [1,2,3,4], '下拉刷新'); } });
  try {
    const grid = root.querySelector('.grid');
    touch(w, grid, 'touchstart', 50, 100); touch(w, grid, 'touchmove', 50, 140); touch(w, grid, 'touchend', 50, 140);
    assert.equal(calls, 0);
    touch(w, grid, 'touchstart', 50, 100); touch(w, grid, 'touchmove', 120, 200); touch(w, grid, 'touchend', 120, 200);
    assert.equal(calls, 0);
    w.scrollY = 300; touch(w, grid, 'touchstart', 50, 100); touch(w, grid, 'touchmove', 50, 200); touch(w, grid, 'touchend', 50, 200);
    assert.equal(calls, 0);
    w.scrollY = 0; touch(w, grid, 'touchstart', 50, 100);
    const move = touch(w, grid, 'touchmove', 50, 200);
    assert(move.defaultPrevented); assert.match(root.querySelector('.list-pull').textContent, /松开刷新/); assert.equal(calls, 0);
    touch(w, grid, 'touchend', 50, 200); assert.equal(calls, 1);
    await wait(850);
    assert.equal(root.querySelector('.title').textContent, '下拉刷新 1'); assert.equal(w.scrollY, 0);
  } finally { w.close(); }
});
test('a new cover waits behind the reader and applies to the same card after returning', async () => {
  const { w, root } = await setup({ automatic: true }); let cache;
  try {
    w.eval(fs.readFileSync(__dirname + '/../src/core/post-cache.js', 'utf8') + ';window.createPostCache = createPostCache;');
    cache = w.createPostCache({ context: w, key: 'nga-cards-v1' });
    const card = root.querySelector('.card');
    root.querySelector('.app').dispatchEvent(new w.Event('wheel', { bubbles: true }));
    const frame = w.document.createElement('iframe'); frame.dataset.readscapeReader = 'true'; w.document.documentElement.append(frame);
    await cache.saveCover('1', 'https://img.nga.cn/new-after-reading.png', { coverW: 640, coverH: 1407 });
    await wait(800); assert.equal(card.querySelector('img'), null);
    frame.remove(); w.document.dispatchEvent(new w.Event('readscape-list-resume'));
    await wait(1500);
    assert.equal(root.querySelector('.card'), card);
    assert.equal(card.querySelector('img').src, 'https://img.nga.cn/new-after-reading.png');
  } finally { cache?.close(); w.close(); }
});

test('a new cover applies automatically after returning even with autoListRefresh disabled', async () => {
  const { w, root } = await setup({ automatic: false }); let cache;
  try {
    w.eval(fs.readFileSync(__dirname + '/../src/core/post-cache.js', 'utf8') + ';window.createPostCache = createPostCache;');
    cache = w.createPostCache({ context: w, key: 'nga-cards-v1' });
    const card = root.querySelector('.card');
    root.querySelector('.app').dispatchEvent(new w.Event('wheel', { bubbles: true }));
    const frame = w.document.createElement('iframe'); frame.dataset.readscapeReader = 'true'; w.document.documentElement.append(frame);
    await cache.saveCover('1', 'https://img.nga.cn/manual-auto-apply.png', { coverW: 640, coverH: 1407 });
    await wait(100);
    assert.equal(card.querySelector('img'), null);
    frame.remove();
    w.document.dispatchEvent(new w.Event('readscape-list-resume'));
    await wait(50);
    assert.equal(card.querySelector('img')?.src, 'https://img.nga.cn/manual-auto-apply.png');
    assert.equal(root.querySelector('.list-refresh').hidden, true, '不应强制用户点击刷新按钮');
    assert(!root.querySelector('.list-refresh-bar').classList.contains('has-update'));
  } finally { cache?.close(); w.close(); }
});

test('clicked post style is preserved on return and defers cover update until scrolled out of view', async () => {
  const { w, root } = await setup({ automatic: true }); let cache;
  try {
    w.eval(fs.readFileSync(__dirname + '/../src/core/post-cache.js', 'utf8') + ';window.createPostCache = createPostCache;');
    cache = w.createPostCache({ context: w, key: 'nga-cards-v1' });
    const card = root.querySelector('.card');
    assert.equal(card.dataset.tid, '1');

    // 用户点击卡片封面
    card.querySelector('.cover').click();

    // 模拟进入阅读器并在阅读期间发现首楼图片缓存为封面
    const frame = w.document.createElement('iframe');
    frame.dataset.readscapeReader = 'true';
    w.document.documentElement.append(frame);
    await cache.saveCover('1', 'https://img.nga.cn/clicked-post-cover.png', { coverW: 640, coverH: 1407 });
    await wait(200);
    assert.equal(card.querySelector('img'), null, '阅读期间不修改列表卡片');

    // 模拟从阅读器返回到列表
    w.document.querySelectorAll('iframe[data-readscape-reader]').forEach(f => f.remove());
    w.document.dispatchEvent(new w.Event('readscape-list-resume'));
    await wait(800);

    // 关键验证：返回后，用户当前点击帖子的样式必须保持恒定，不突变、不刷新、不注入图片封面
    assert.equal(card.querySelector('img'), null, '返回后用户点击帖子的样式必须恒定保持，不得立即刷新注入封面');
    assert.equal(card.classList.contains('card-updated'), false, '不得触发卡片刷新动画');

    // 模拟用户上下滑动列表，该卡片滑出视口
    card.getBoundingClientRect = () => ({ top: -300, bottom: -50, width: 200, height: 150 });
    w.dispatchEvent(new w.Event('scroll'));
    root.querySelector('.app').dispatchEvent(new w.Event('scroll', { bubbles: true }));
    await wait(150);

    // 卡片在视口外时静默完成更新
    assert.equal(card.querySelector('img')?.src, 'https://img.nga.cn/clicked-post-cover.png', '滑出视口后静默更新封面');
  } finally { cache?.close(); w.close(); }
});

test('posts currently in view maintain constant style while out of view posts update on scroll', async () => {
  const { w, root } = await setup({ automatic: true }); let cache;
  try {
    w.eval(fs.readFileSync(__dirname + '/../src/core/post-cache.js', 'utf8') + ';window.createPostCache = createPostCache;');
    cache = w.createPostCache({ context: w, key: 'nga-cards-v1' });
    const cards = [...root.querySelectorAll('.card')];
    const inViewCard = cards[0];
    const outOfViewCard = cards[1];

    // 模拟卡片位置：inViewCard 在视口内，outOfViewCard 在视口外下方
    inViewCard.getBoundingClientRect = () => ({ top: 100, bottom: 250, width: 200, height: 150 });
    outOfViewCard.getBoundingClientRect = () => ({ top: 900, bottom: 1050, width: 200, height: 150 });

    // 两个卡片同时收到封面更新通知
    await cache.saveCover(inViewCard.dataset.tid, 'https://img.nga.cn/in-view.png', { coverW: 640, coverH: 1407 });
    await cache.saveCover(outOfViewCard.dataset.tid, 'https://img.nga.cn/out-of-view.png', { coverW: 640, coverH: 1407 });
    await wait(100);

    // 用户滚动页面
    root.querySelector('.app').dispatchEvent(new w.Event('scroll', { bubbles: true }));
    await wait(150);

    // 视口内的卡片样式恒定不变，不在视口的卡片已完成更新
    assert.equal(inViewCard.querySelector('img'), null, '视口内的卡片样式恒定不变');
    assert.equal(outOfViewCard.querySelector('img')?.src, 'https://img.nga.cn/out-of-view.png', '不在视口的卡片在滚动时已更新');
  } finally { cache?.close(); w.close(); }
});
