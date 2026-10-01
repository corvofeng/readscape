function runAdapter({ navigation }) {
  if (window.top !== window.self || document.getElementById('nga-cards-host')) return;

  const KEY = 'nga-cards-v1';
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 禁用存储时仍可阅读 */ } };
  const prefs = read(KEY, { enabled: true, single: false, autoPreview: false });
  const favorites = read(`${KEY}-favorites`, {});
  const pageURL = new URL(location.href);
  const host = document.createElement('div');
  host.id = 'nga-cards-host';
  // Shadow DOM 避免 NGA 自带 CSS 与卡片样式互相影响。
  const shadow = host.attachShadow({ mode: 'open' });
  const originalOverflow = document.documentElement.style.overflow;
  const originalViewport = document.querySelector('meta[name="viewport"]');
  const originalViewportContent = originalViewport?.getAttribute('content');
  const viewport = originalViewport || document.createElement('meta');
  viewport.name = 'viewport';
  let items = [], tab = 'all', query = '', signature = '', timer, active = 0;
  const queue = [], pending = new Set(), cache = new Map();
  let previewObserver;
  let gateHandled = false, gateTimer;
  let modeToggle = toggle;
  let settingsRefresh = render;
  let readingSettings;

  const css = /* LIST_CSS */;
  const node = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const safeURL = (raw, base = location.href) => {
    try { const u = new URL(raw, base); return /^(https?:)$/.test(u.protocol) ? u : null; } catch { return null; }
  };
  const link = (url, text, cls = '') => { const a = node('a', cls, text); a.href = url; return a; };
  const button = (text, cls, action) => { const b = node('button', cls, text); b.type = 'button'; b.addEventListener('click', action); return b; };
  const savePrefs = () => write(KEY, prefs);

  shadow.append(node('style', '', css));
  const app = node('div', 'app'); app.hidden = true;
  const top = node('header', 'top'), bar = node('div', 'bar');
  const brand = node('div', 'brand', '阅境 '); brand.append(node('span', '', '· NGA'));
  const search = node('div', 'search'), input = node('input');
  input.type = 'search'; input.placeholder = '搜索本页标题 / 作者'; input.setAttribute('aria-label', '搜索本页标题或作者');
  input.addEventListener('input', () => { query = input.value.trim().toLowerCase(); render(); });
  search.append(input);
  const mobileSearch = button('', 'mobile-tool', () => {
    const open = app.classList.toggle('search-open'); mobileSearch.setAttribute('aria-expanded', String(open));
    if (open) input.focus();
  }); mobileSearch.setAttribute('aria-label', '展开或收起搜索'); mobileSearch.setAttribute('aria-expanded', 'false');
  const mobileOptions = button('', 'mobile-tool', () => {
    mobileOptions.setAttribute('aria-expanded', String(app.classList.toggle('options-open')));
  }); mobileOptions.setAttribute('aria-label', '展开或收起设置'); mobileOptions.setAttribute('aria-expanded', 'false');
  for (const [control, path] of [[mobileSearch, 'M21 21l-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0'], [mobileOptions, 'M5 6h14M5 12h14M5 18h14']]) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '21'); svg.setAttribute('height', '21'); svg.setAttribute('aria-hidden', 'true');
    shape.setAttribute('d', path); shape.setAttribute('fill', 'none'); shape.setAttribute('stroke', 'currentColor'); shape.setAttribute('stroke-width', '1.7'); shape.setAttribute('stroke-linecap', 'round');
    svg.append(shape); control.append(svg);
  }
  bar.append(brand, search, node('div', 'spacer'), mobileSearch, mobileOptions, button('切回原版', 'pill', () => toggle(false)));
  top.append(bar);
  const main = node('main'), intro = node('div', 'intro'), heading = node('div');
  const h1 = node('h1', '', '论坛发现'), subtitle = node('div', 'sub');
  heading.append(h1, subtitle);
  const settings = node('div', 'settings');
  for (const [prop, label] of [['single', '手机单列'], ['autoPreview', '自动预览首楼']]) {
    const wrap = node('label'), check = node('input'); check.type = 'checkbox'; check.checked = !!prefs[prop];
    check.addEventListener('change', () => { prefs[prop] = check.checked; savePrefs(); render(); });
    wrap.append(check, document.createTextNode(label)); settings.append(wrap);
  }
  settings.append(button('原版页面 ↗', 'settings-native', () => toggle(false)));
  intro.append(heading, settings);
  const tabs = node('nav', 'tabs'); tabs.setAttribute('aria-label', '帖子筛选'); tabs.setAttribute('role', 'tablist');
  for (const [id, label] of [['all', '全部'], ['hot', '热议'], ['saved', '收藏']]) {
    const b = button(label, '', () => { tab = id; render(); }); b.dataset.tab = id; b.setAttribute('role', 'tab'); tabs.append(b);
  }
  const grid = node('section', 'grid'); grid.setAttribute('aria-label', '帖子卡片');
  const empty = node('div', 'empty'), pager = node('nav', 'pager'); pager.setAttribute('aria-label', '论坛分页');
  main.append(intro, tabs, grid, empty, pager, node('div', 'foot', '按原站顺序展示 · 热议为本页回复 ≥ 100 · 收藏仅存本浏览器'));
  app.append(top, main);
  const restore = button('卡片模式', 'restore', () => toggle(true)); restore.hidden = true;
  shadow.append(app, restore); document.body.append(host);
  readingSettings = mountSettings({ shadow, app, prefs, save: savePrefs, change: () => { if (prefs.smoothNavigation === false) navigation.finish(); settingsRefresh(); settings.querySelectorAll('input').forEach(c => { c.checked = !!prefs[c.parentElement.textContent.includes('单列') ? 'single' : 'autoPreview']; }); }, original: () => modeToggle(false) });
  readingSettings.visibility(false);
  const viewportObserver = new MutationObserver(() => {
    if (!app.hidden && (viewport.content !== 'width=device-width, initial-scale=1, viewport-fit=cover' || document.head.firstElementChild !== viewport)) setViewport(true);
  });
  viewportObserver.observe(document.head, {childList:true,subtree:true,attributes:true,attributeFilter:['content']});
  window.addEventListener('pagehide', () => viewportObserver.disconnect());

  // 仅点击 NGA 已提供的普通跳转链接；不调用未公开接口，不点击登录或验证按钮。
  // sessionStorage 跨刷新计数：同一板块两分钟最多尝试两次，防止跳转循环。
  function autoContinue() {
    if (gateHandled || document.title !== '访客不能直接访问') return;
    const target = [...document.querySelectorAll('a')].find(a => /如不能自动跳转\s*[，,]?\s*可点此链接/.test(a.textContent));
    if (!target) return;
    gateHandled = true;
    if (prefs.enabled !== false && prefs.smoothNavigation !== false) navigation.show();
    const notice = node('div', '', '正在点击 NGA 的跳转链接…');
    notice.style.cssText = 'position:fixed;bottom:20px;left:16px;right:16px;max-width:460px;z-index:2147483001;padding:13px 16px;background:#fff;color:#555;border:1px solid #eee;border-radius:12px;box-shadow:0 4px 20px #0001;font-size:13px;line-height:1.6';
    shadow.append(notice);
    const retryKey = `${KEY}-continue-${pageURL.searchParams.get('stid') || pageURL.searchParams.get('fid') || `tid-${pageURL.searchParams.get('tid') || 'list'}`}`;
    let state;
    try {
      state = JSON.parse(sessionStorage.getItem(retryKey) || 'null');
      if (!state || Date.now() - state.start > 120000) state = { start: Date.now(), count: 0 };
      if (state.count >= 2) { navigation.finish(); notice.textContent = '自动跳转已尝试两次。请使用原页登录或手动点击链接。'; return; }
      state.count++;
      sessionStorage.setItem(retryKey, JSON.stringify(state));
    } catch {
      navigation.finish(); notice.textContent = '浏览器不允许记录跳转次数，请手动点击原页链接。'; return;
    }
    gateTimer = setTimeout(() => {
      if (!target.isConnected || document.title !== '访客不能直接访问') { notice.remove(); return; }
      // 使用原链接 onclick（当前页面为 g()），而非猜测/重写跳转地址。
      target.click();
      setTimeout(() => {
        if (items.length || document.title !== '访客不能直接访问') notice.remove();
        else notice.textContent = '已点击原生跳转链接；若仍停留在此页，请登录后访问。';
      }, 5000);
    }, 1200);
  }

  function toggle(enabled) {
    prefs.enabled = enabled; savePrefs();
    app.hidden = !enabled || !items.length;
    restore.hidden = enabled || !items.length;
    document.documentElement.style.overflow = app.hidden ? originalOverflow : 'hidden';
    setViewport(!app.hidden);
    readingSettings?.visibility(!app.hidden);
    if (!app.hidden) navigation.finish();
    if (app.hidden) previewObserver?.disconnect(); else { render(); pump(); }
  }
  function setViewport(enabled) {
    if (enabled) {
      viewport.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
      if (!viewport.isConnected) document.head.append(viewport);
      // 原站可能晚于脚本写入第二个 viewport，以最先声明的阅读视口为准。
      if (document.head.firstElementChild !== viewport) document.head.prepend(viewport);
    } else if (!originalViewport) viewport.remove();
    else if (originalViewportContent == null) viewport.removeAttribute('content');
    else viewport.setAttribute('content', originalViewportContent);
  }
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('切换 NGA 阅读 / 原版', () => modeToggle(!prefs.enabled));
  }

  function extract() {
    const result = [], seen = new Set();
    // 优先常见 NGA topic 类，同时兼容 table / li 列表；不依赖数字化动态 ID。
    for (const a of [...document.querySelectorAll('a.topic, a[id^="t_tt"], .c2 > a[href*="read.php"]'), ...document.querySelectorAll('a[href*="read.php"]')]) {
      if (a.matches('.replydate,.replies,.reply') || a.closest('.c1,.c4,[id^="t_pc"]')) continue;
      const u = safeURL(a.getAttribute('href'));
      if (!u || u.origin !== location.origin || !/\/read\.php$/.test(u.pathname)) continue;
      const tid = u.searchParams.get('tid');
      if (!tid || !/^\d+$/.test(tid) || seen.has(tid)) continue;
      if (+u.searchParams.get('page') > 1 && !a.classList.contains('topic')) continue;
      const title = a.textContent.trim();
      if (title.length < 3 || /^[\d\s.>…]+$/.test(title) || /^(?:(?:今天|昨天|前天)\s*\d{1,2}:\d{2}|\d+\s*(?:分钟前|小时前)|\d{2}-\d{2}\s+\d{1,2}:\d{2})$/.test(title)) continue;
      const row = a.closest('tr, .topicrow, .topic-row, li');
      if (!row) continue;
      seen.add(tid);
      const users = [...row.querySelectorAll('a[href*="uid="], a.author')];
      const replyEl = row.querySelector('.replies, .reply, .c1');
      const firstCell = row.querySelector('td');
      const numeric = [replyEl?.textContent, firstCell?.textContent].map(x => (x || '').trim()).find(x => /^\d[\d,]*$/.test(x)) || '';
      const replies = /^\d[\d,]*$/.test(numeric) ? Number(numeric.replaceAll(',', '')) : null;
      const cells = [...row.querySelectorAll('td')];
      const last = cells.at(-1);
      const author = users[0]?.textContent.trim() || row.querySelector('.author')?.textContent.trim() || '';
      const timeMatch = (last?.textContent || '').match(/(?:\d+\s*分钟前|\d+\s*小时前|(?:今天|昨天|前天)\s*\d{1,2}:\d{2}|\d{2}-\d{2}\s+\d{1,2}:\d{2})/);
      const pageLinks = [...row.querySelectorAll('a[href*="read.php"]')].map(x => safeURL(x.getAttribute('href'))).filter(x => x?.origin === u.origin && x.searchParams.get('tid') === tid);
      const replyURL = safeURL(row.querySelector('a.replydate')?.getAttribute('href') || '');
      const lastURL = replyURL?.origin === u.origin && replyURL.searchParams.get('tid') === tid ? replyURL : pageLinks.sort((x, y) => Number(y.searchParams.get('page') || 1) - Number(x.searchParams.get('page') || 1))[0];
      u.searchParams.delete('page'); u.hash = '';
      result.push({ tid, title, author, replies, time: timeMatch?.[0] || '', url: u.href, latest: lastURL?.href || '', pinned: /置顶/.test(title) || /(?:^|\s)(?:top|sticky)(?:\s|$)/i.test(row.className) });
    }
    return result;
  }

  function scan() {
    autoContinue();
    const found = extract();
    const sig = JSON.stringify(found);
    if (sig === signature) return;
    signature = sig; items = found;
    if (!items.length) {
      app.hidden = restore.hidden = true;
      readingSettings.visibility(false);
      document.documentElement.style.overflow = originalOverflow;
      setViewport(false);
      return;
    }
    const board = [...document.querySelectorAll('a[href*="thread.php"]')].find(a => {
      const u = safeURL(a.getAttribute('href'));
      return u && u.searchParams.get('stid') === pageURL.searchParams.get('stid') && a.textContent.trim().length > 3;
    });
    h1.textContent = board?.textContent.trim() || document.title.replace(/\s*[-_].*NGA.*$/i, '') || '论坛发现';
    toggle(!!prefs.enabled);
    renderPager();
  }

  function renderPager() {
    pager.replaceChildren();
    const pages = new Map(), current = Number(pageURL.searchParams.get('page') || 1);
    pages.set(current, location.href);
    for (const a of document.querySelectorAll('a[href*="thread.php"]')) {
      const u = safeURL(a.getAttribute('href'));
      if (!u || u.origin !== pageURL.origin || u.pathname !== pageURL.pathname) continue;
      if (['stid', 'fid'].some(k => u.searchParams.get(k) !== pageURL.searchParams.get(k))) continue;
      if (!/^(?:\d+|后页|前页|下一页|上一页|>|<|»|«)$/.test(a.textContent.trim().replace(/\p{M}/gu, ''))) continue;
      const page = Number(u.searchParams.get('page') || 1);
      if (Number.isInteger(page) && page > 0) pages.set(page, u.href);
    }
    for (const [p, url] of [...pages].sort((a, b) => a[0] - b[0])) {
      const el = p === current ? node('span', 'current', String(p)) : link(url, String(p));
      if (p === current) el.setAttribute('aria-current', 'page');
      pager.append(el);
    }
    pager.append(button('原版翻页 / 登录', 'pill', () => toggle(false)));
  }

  const palette = ['#f5e7df', '#e5ebdf', '#e7e8f3', '#f5e5e8', '#e0edef', '#f2eddf'];
  const color = tid => palette[Number(tid.slice(-4)) % palette.length];
  const count = n => n == null ? '讨论' : n >= 10000 ? `${(n / 10000).toFixed(1)}万回复` : `${n} 回复`;

  function render() {
    previewObserver?.disconnect();
    grid.replaceChildren(); grid.classList.toggle('single', !!prefs.single);
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    // 收藏包含曾浏览过的其他页；全部与热议始终保持当前页原始顺序。
    const source = tab === 'saved' ? Object.values(favorites) : items;
    const visible = source.filter(item => (tab !== 'hot' || item.replies >= 100) && (!query || `${item.title} ${item.author}`.toLowerCase().includes(query)));
    subtitle.textContent = `第 ${pageURL.searchParams.get('page') || 1} 页 · ${visible.length} 篇${query ? ' · 本页搜索' : ''}`;
    empty.textContent = tab === 'saved' ? '点击卡片上的 ♡ 收藏帖子。' : '没有符合条件的帖子。';
    empty.hidden = visible.length > 0;
    for (const item of visible) grid.append(makeCard(item));
    if (prefs.autoPreview && prefs.enabled && typeof IntersectionObserver !== 'undefined') {
      previewObserver = new IntersectionObserver(entries => {
        for (const entry of entries) if (entry.isIntersecting) {
          previewObserver.unobserve(entry.target);
          const item = visible.find(x => x.tid === entry.target.dataset.tid);
          if (item) enqueue(item);
        }
      }, { root: app, rootMargin: '120px' });
      for (const card of grid.children) if (!cache.has(card.dataset.tid)) previewObserver.observe(card);
    }
  }

  function makeCard(item) {
    const card = node('article', 'card'); card.dataset.tid = item.tid; card.style.setProperty('--bg', color(item.tid));
    const cover = link(item.url, '', 'cover');
    const eye = node('div', 'eyebrow', 'NGA · 讨论');
    if (item.pinned) eye.append(node('span', 'tag', '置顶'));
    else if (item.replies >= 100) eye.append(node('span', 'tag', '热议'));
    cover.append(eye, node('div', 'title', item.title));
    const body = node('div', 'body');
    const person = node('div', 'person');
    person.append(node('span', 'avatar', item.author.slice(0, 1) || 'N'), node('span', 'author', item.author || '作者未识别'));
    const saved = !!favorites[item.tid];
    const fav = button(saved ? '♥' : '♡', 'save', () => {
      if (favorites[item.tid]) delete favorites[item.tid]; else favorites[item.tid] = { ...item };
      write(`${KEY}-favorites`, favorites);
      const state = !!favorites[item.tid]; fav.textContent = state ? '♥' : '♡'; fav.setAttribute('aria-pressed', String(state));
      if (tab === 'saved') render();
    });
    fav.setAttribute('aria-label', '收藏帖子'); fav.setAttribute('aria-pressed', String(saved)); person.append(fav);
    const meta = node('div', 'meta'); meta.append(node('span', '', count(item.replies)), node('span', '', item.time));
    if (item.latest && item.latest !== item.url && new URL(item.latest).searchParams.has('page')) meta.append(link(item.latest, '最新回复', 'latest'));
    const preview = button('预览首楼', 'preview', () => enqueue(item));
    body.append(link(item.url, item.title, 'mobile-caption'), person, meta, preview); card.append(cover, body);
    if (cache.has(item.tid)) applyPreview(card, item, cache.get(item.tid));
    else if (pending.has(item.tid)) { preview.textContent = '正在加载首楼…'; preview.disabled = true; }
    return card;
  }

  function applyPreview(card, item, data) {
    const preview = card.querySelector('.preview');
    preview.disabled = true;
    preview.textContent = data.error || '摘要来自首楼';
    if (data.error) return;
    const body = card.querySelector('.body');
    if (data.summary && !body.querySelector('.summary')) body.prepend(node('p', 'summary', data.summary));
    if (data.image && !card.querySelector('img')) {
      const cover = card.querySelector('.cover');
      const img = node('img'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'same-origin'; img.src = data.image;
      img.addEventListener('error', () => { card.classList.remove('with-image'); cover.classList.remove('has-image'); cover.replaceChildren(node('div', 'title', item.title)); body.querySelector('.image-title')?.remove(); });
      card.classList.add('with-image');
      cover.classList.add('has-image'); cover.replaceChildren(img);
      body.prepend(link(item.url, item.title, 'image-title'));
    }
  }

  function enqueue(item) {
    if (cache.has(item.tid) || pending.has(item.tid)) return;
    pending.add(item.tid); queue.push(item);
    for (const card of grid.children) if (card.dataset.tid === item.tid) {
      const b = card.querySelector('.preview'); b.textContent = '正在加载首楼…'; b.disabled = true;
    }
    pump();
  }

  function pump() {
    if (active >= 2 || !queue.length || !prefs.enabled) return;
    const item = queue.shift(); active++;
    loadPreview(item).then(data => {
      cache.set(item.tid, data);
      for (const card of grid.children) if (card.dataset.tid === item.tid) applyPreview(card, item, data);
    }).finally(() => { pending.delete(item.tid); active--; setTimeout(pump, 700); });
    if (active < 2 && queue.length) setTimeout(pump, 700);
  }

  async function loadPreview(item) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const u = safeURL(item.url);
      if (!u || u.origin !== location.origin) return { error: '此收藏来自其他 NGA 域名，请打开原帖' };
      const response = await fetch(u.href, { credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) return { error: `加载失败 (${response.status}) · 请打开原帖` };
      const bytes = new Uint8Array(await response.arrayBuffer());
      const initial = new TextDecoder('utf-8').decode(bytes);
      const encoding = response.headers.get('content-type')?.match(/charset\s*=\s*([\w-]+)/i)?.[1] || initial.slice(0, 4096).match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || 'utf-8';
      const html = new TextDecoder(encoding).decode(bytes);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const content = doc.querySelector('#postcontent0, .postcontent, [id^="postcontent"]');
      if (!content) return { error: '需要登录或无法解析 · 请打开原帖' };
      let image;
      for (const img of content.querySelectorAll('img')) {
        const raw = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('src');
        const url = raw && safeURL(raw, response.url || u.href);
        if (url && !/smile|smilie|emotion|avatar|\.gif(?:\?|$)/i.test(url.href)) { image = url.href; break; }
      }
      content.querySelectorAll('script,style,blockquote,.quote,.signature').forEach(el => el.remove());
      content.querySelectorAll('br').forEach(el => el.replaceWith(doc.createTextNode('\n')));
      const summary = content.textContent.replace(/\s+/g, ' ').trim().slice(0, 180);
      return { summary, image };
    } catch (error) {
      return { error: error.name === 'AbortError' ? '加载超时 · 请打开原帖' : '加载失败 · 请打开原帖' };
    } finally { clearTimeout(timeout); }
  }

  /* READER_MODULE */
  if (/\/read\.php$/.test(pageURL.pathname)) { startReader(); return; }
  scan();
  // 列表由 NGA 后续脚本生成时再扫描，不覆盖登录/错误页。
  const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 220); });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener('pagehide', () => { observer.disconnect(); previewObserver?.disconnect(); clearTimeout(timer); clearTimeout(gateTimer); });
}
