const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const script = fs.readFileSync(__dirname + '/../dist/readscape-nga.user.js', 'utf8');

function setup(url = 'https://bbs.nga.cn/thread.php?fid=7', body = '') {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>艾泽拉斯议事厅 NGA玩家社区</title></head><body>${body}</body></html>`;
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, { url, runScripts: 'dangerously', virtualConsole: vc });
  const w = dom.window;
  w.TextDecoder = TextDecoder;
  w.localStorage.setItem('nga-cards-v1', JSON.stringify({ enabled: true }));
  return { dom, w, vc };
}

test('board switcher button exists in toolbar and opens dialog', async () => {
  const { w } = setup('https://bbs.nga.cn/thread.php?fid=7', '<table id="topicrows"><tr class="topicrow"><td class="c2"><a class="topic" href="/read.php?tid=101">测试主题帖子标题</a></td><td class="c3"><a class="author">测试作者</a></td></tr></table>');
  w.eval(script);

  const host = w.document.getElementById('nga-cards-host');
  assert(host, '宿主节点应存在');
  const root = host.shadowRoot;

  // 检查顶部工具栏中的板块按钮
  const boardBtn = root.querySelector('.board-bar-btn');
  assert(boardBtn, '顶部栏应有切换板块按钮');
  assert.equal(boardBtn.textContent.trim(), '板块');

  // 检查弹窗初始状态
  const dialog = root.querySelector('.board-dialog');
  assert(dialog, 'ShadowRoot 内应包含板块切换 dialog');
  assert.equal(dialog.open, false, '弹窗初始应为关闭状态');

  // 点击板块按钮打开弹窗
  boardBtn.click();
  assert.equal(dialog.open, true, '点击板块按钮后弹窗应打开');

  // 检查标题与关闭按钮
  const title = root.querySelector('.board-dialog-title');
  assert.match(title.textContent, /切换论坛板块/);
  const closeBtn = root.querySelector('.board-dialog-close');
  closeBtn.click();
  assert.equal(dialog.open, false, '点击关闭按钮应关闭弹窗');
  w.close();
});

test('board title badge opens switcher dialog and shows current board active', async () => {
  const { w } = setup('https://bbs.nga.cn/thread.php?fid=7', '<table id="topicrows"><tr class="topicrow"><td class="c2"><a class="topic" href="/read.php?tid=101">测试主题帖子标题</a></td><td class="c3"><a class="author">测试作者</a></td></tr></table>');
  w.eval(script);

  const root = w.document.getElementById('nga-cards-host').shadowRoot;
  const switchBadge = root.querySelector('.board-title-switch');
  assert(switchBadge, '主标题旁应有快速切换徽章');
  assert.match(switchBadge.textContent, /切换/);

  const dialog = root.querySelector('.board-dialog');
  switchBadge.click();
  assert.equal(dialog.open, true, '点击标题切换徽章应打开弹窗');

  // 当前板块（艾泽拉斯议事厅 FID 7）应在卡片列表中标为当前
  const currentCard = root.querySelector('.board-card.is-active');
  assert(currentCard, '应有高亮标记的当前板块');
  assert.match(currentCard.textContent, /艾泽拉斯议事厅/);
  assert.match(currentCard.textContent, /当前/);
  w.close();
});

test('subforum strip renders subforums from page data and DOM links', async () => {
  const bodyHtml = `
    <div id="m_nav"><a href="/thread.php?fid=7">艾泽拉斯议事厅</a></div>
    <span id="sub_forums_c">
      <a href="/thread.php?fid=255">团队管理经验交流 (管理经验交流)</a>
      <a href="/thread.php?fid=310">精英议会 (前瞻高阶讨论)</a>
      <a href="/thread.php?stid=25124476">MDI锦标赛</a>
    </span>
    <table id="topicrows"><tr class="topicrow"><td class="c2"><a class="topic" href="/read.php?tid=101">测试主题帖子标题</a></td><td class="c3"><a class="author">测试作者</a></td></tr></table>
  `;
  const { w } = setup('https://bbs.nga.cn/thread.php?fid=7', bodyHtml);
  w.eval(script);

  const root = w.document.getElementById('nga-cards-host').shadowRoot;
  const strip = root.querySelector('.subforum-strip');
  assert(strip, '应存在子版块横条');
  assert.equal(strip.hidden, false, '有子版块时横条不应隐藏');

  const chips = [...strip.querySelectorAll('.subforum-chip')];
  assert(chips.length >= 3, '应提取到子版块 chips');
  assert.equal(chips[0].textContent.trim(), '全部');
  assert(chips[0].classList.contains('is-active'), '主板块当前应在“全部”激活');
  assert.equal(chips[1].textContent.trim(), '团队管理经验交流');
  assert.equal(chips[2].textContent.trim(), '精英议会');

  // 更多板块芯片应在新标签页打开论坛主页
  const moreChip = strip.querySelector('.subforum-chip-more');
  assert(moreChip, '应存在更多板块芯片');
  assert.equal(moreChip.getAttribute('href'), '/index.php', '更多板块应直接链接到论坛主页');
  assert.equal(moreChip.target, '_blank', '更多板块应在新页面打开');
  assert.equal(moreChip.rel, 'noopener noreferrer', '应具备安全 rel 属性');

  // 弹窗内的子版块区域也应展示
  const boardBtn = root.querySelector('.board-bar-btn');
  boardBtn.click();
  const subSection = root.querySelector('.board-section-subforums');
  assert.equal(subSection.hidden, false, '弹窗内应展现当前板块的子版块区域');
  const subChips = root.querySelectorAll('.board-subforums-list .board-chip');
  assert(subChips.length >= 3);
  w.close();
});

test('search filters boards in real-time and supports numeric FID jump', async () => {
  const { w } = setup('https://bbs.nga.cn/thread.php?fid=7', '<table id="topicrows"><tr class="topicrow"><td class="c2"><a class="topic" href="/read.php?tid=101">测试主题帖子标题</a></td><td class="c3"><a class="author">测试作者</a></td></tr></table>');
  w.eval(script);

  const root = w.document.getElementById('nga-cards-host').shadowRoot;
  root.querySelector('.board-bar-btn').click();

  const searchInput = root.querySelector('.board-search-input');
  const jumpBtn = root.querySelector('.board-jump-fid');
  assert.equal(jumpBtn.hidden, true, '初始未输入数字时跳转按钮隐藏');

  // 搜索关键词“原神”
  searchInput.value = '原神';
  searchInput.dispatchEvent(new w.Event('input'));

  let cards = [...root.querySelectorAll('.board-cards-grid .board-card')];
  assert(cards.length > 0, '搜索原神应有结果');
  assert(cards.every(c => c.textContent.includes('原神') || c.textContent.includes('米哈游')));

  // 搜索数字 FID
  searchInput.value = '414';
  searchInput.dispatchEvent(new w.Event('input'));
  assert.equal(jumpBtn.hidden, false, '输入数字 FID 时应显示直达按钮');
  assert.match(jumpBtn.textContent, /进入 FID 414/);
  cards = [...root.querySelectorAll('.board-cards-grid .board-card')];
  assert(cards.some(c => c.textContent.includes('Steam') || c.textContent.includes('414')));

  // 清空搜索后恢复分类导航
  searchInput.value = '';
  searchInput.dispatchEvent(new w.Event('input'));
  assert.equal(jumpBtn.hidden, true);
  assert.equal(root.querySelector('.board-category-tabs').hidden, false);
  w.close();
});

test('recent boards records visits and allows one-click clear', async () => {
  const { w } = setup('https://bbs.nga.cn/thread.php?fid=414', '<table id="topicrows"><tr class="topicrow"><td class="c2"><a class="topic" href="/read.php?tid=101">Steam促销讨论</a></td><td class="c3"><a class="author">测试作者</a></td></tr></table>');
  w.eval(script);

  const root = w.document.getElementById('nga-cards-host').shadowRoot;
  root.querySelector('.board-bar-btn').click();

  // 检查最近访问中是否有刚访问的 Steam 综合
  const recentSection = root.querySelector('.board-section-recent');
  assert.equal(recentSection.hidden, false, '访问过板块后最近访问应显示');
  const recentChips = root.querySelectorAll('.board-recent-list .board-chip');
  assert(recentChips.length >= 1);
  assert.match(recentChips[0].textContent, /Steam综合讨论/);

  // 清空最近访问
  const clearBtn = root.querySelector('.board-clear-recent');
  clearBtn.click();
  assert.equal(recentSection.hidden, true, '清空后最近访问区域应隐藏');
  w.close();
});

test('root URL and forum.php render board portal selection interface', async () => {
  const { w } = setup('https://bbs.nga.cn/forum.php', '<div class="forum-native-content"><a href="/thread.php?fid=999">自定义全新板块</a></div>');
  w.eval(script);

  const root = w.document.getElementById('nga-cards-host').shadowRoot;
  const app = root.querySelector('.app');
  assert.equal(app.hidden, false, '访问 forum.php 时阅读界面应激活展示板块导航');

  const titleText = root.querySelector('.board-title-text');
  assert.match(titleText.textContent, /选择论坛板块/);

  const portal = root.querySelector('.board-portal-view');
  assert(portal, 'forum.php 页面应展示板块导航 Portal 全景视图');

  const banner = root.querySelector('.board-portal-banner');
  assert(banner, 'Portal 视图中应有欢迎横幅');
  assert.match(banner.textContent, /版块导航/);

  // 检查包含分类导航条与搜索输入框
  const catBar = root.querySelector('.board-portal-cat-bar');
  assert(catBar, '应存在分栏分类标签导航条');
  const catBtns = root.querySelectorAll('.board-portal-cat-btn');
  assert(catBtns.length >= 5, '应渲染出多个板块分类分栏按钮');

  const searchInput = root.querySelector('.board-portal-search-input');
  assert(searchInput, '主页应提供板块实时搜索输入框');

  // 检查原版页面动态解析的板块
  assert(portal.textContent.includes('自定义全新板块'), '原版 DOM 中解析到的板块应展示在主页中');

  // 检查包含热门分类
  assert(portal.textContent.includes('常用热门'));
  assert(portal.textContent.includes('手机游戏'));
  assert(portal.textContent.includes('魔兽世界'));
  w.close();
});

test('mobile touch isolation locks document scroll and prevents background scrolling', async () => {
  const { w } = setup('https://bbs.nga.cn/thread.php?fid=7', '<table id="topicrows"><tr class="topicrow"><td class="c2"><a class="topic" href="/read.php?tid=101">测试主题帖子标题</a></td><td class="c3"><a class="author">测试作者</a></td></tr></table>');
  try {
    w.eval(script);

    const root = w.document.getElementById('nga-cards-host').shadowRoot;
    const app = root.querySelector('.app');
    const boardBtn = root.querySelector('.board-bar-btn');
    const dialog = root.querySelector('.board-dialog');

    // 打开板块切换器
    boardBtn.click();
    assert.equal(dialog.open, true);
    assert.equal(app.classList.contains('boards-open'), true, '打开板块切换器时 app 应添加 boards-open 类');
    assert.equal(w.document.documentElement.classList.contains('rt-boards-locked'), true, '打开板块切换器时 html 应添加锁定类');
    assert.equal(w.document.body.classList.contains('rt-boards-locked'), true, '打开板块切换器时 body 应添加锁定类');
    assert.equal(w.document.documentElement.style.overflow, 'hidden', '打开板块切换器时 html 应锁定 overflow: hidden');
    assert.equal(w.document.body.style.overflow, 'hidden', '打开板块切换器时 body 应锁定 overflow: hidden');
    assert.equal(w.document.body.style.touchAction, 'none', '打开板块切换器时 body 应锁定 touch-action: none');

    // 检查 sheet 容器及关闭后恢复
    const closeBtn = root.querySelector('.board-dialog-close');
    closeBtn.click();
    assert.equal(dialog.open, false);
    assert.equal(app.classList.contains('boards-open'), false, '关闭后 boards-open 应被移除');
    assert.equal(w.document.documentElement.classList.contains('rt-boards-locked'), false, '关闭后锁定类应被移除');
    assert.equal(w.document.body.classList.contains('rt-boards-locked'), false, '关闭后 body 锁定类应被移除');
  } finally {
    w.close();
  }
});

