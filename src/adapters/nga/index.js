function runAdapter({ navigation, postCache, context = globalThis.window }) {
  const window = context;
  const { document, location, localStorage, sessionStorage } = window;
  const fetch = (...args) => window.fetch(...args);
  if (document.getElementById('nga-cards-host')) return;

  const KEY = 'nga-cards-v1';
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 禁用存储时仍可阅读 */ } };
  const prefs = read(KEY, { enabled: true, single: false });
  const favorites = read(`${KEY}-favorites`, {}), favoriteChanges = new Set();
  const pageURL = new URL(location.href);
  const host = document.createElement('div');
  host.id = 'nga-cards-host';
  // Shadow DOM 避免 NGA 自带 CSS 与卡片样式互相影响。
  const shadow = host.attachShadow({ mode: 'open' });
  const originalOverflow = document.documentElement.style.overflow;
  let nativeScroll, readingScroll = 0;
  const mobileViewport = window.matchMedia?.('(max-width:600px)');
  // 原页只作为数据源保留。阅读容器放在 body 外，避免原站的布局、
  // transform 和触摸滚动影响前景；晚到的原页节点也不会重新露出。
  const surfaceStyle = document.createElement('style');
  surfaceStyle.textContent = `
    html[data-readscape-active]{overflow:hidden!important;overscroll-behavior:none!important;height:100%!important;margin:0!important;padding:0!important;transform:none!important;filter:none!important;perspective:none!important;contain:none!important;content-visibility:visible!important;background:#fafafa!important}
    html[data-readscape-active]>body{display:none!important}
    html[data-readscape-active]::before,html[data-readscape-active]::after{display:none!important}
    html[data-readscape-active]>#nga-cards-host{all:initial!important;display:block!important;position:fixed!important;inset:0!important;width:100%!important;height:100%!important;height:100dvh!important;z-index:2147483000!important;isolation:isolate!important}
    html[data-readscape-document-scroll]{overflow-x:clip!important;overflow-y:auto!important;height:auto!important;min-height:100%!important;overscroll-behavior-y:auto!important}
    html[data-readscape-document-scroll]>#nga-cards-host{position:relative!important;inset:auto!important;height:auto!important;min-height:100svh!important;contain:none!important}
    html[data-readscape-reader-open]{overflow:hidden!important;overscroll-behavior:none!important}
  `;
  document.head.append(surfaceStyle);
  const originalViewport = document.querySelector('meta[name="viewport"]');
  const originalViewportContent = originalViewport?.getAttribute('content');
  const viewport = originalViewport || document.createElement('meta');
  viewport.name = 'viewport';
  let items = [], tab = 'all', query = '', signature = '', timer;
  let cardObserver, listObserver;
  const listCards = new Map();
  let coverDisposed = false;
  let gateHandled = false, gateTimer;
  let modeToggle = toggle;
  let settingsRefresh = render;
  let readingSettings;
  let accountChanged = () => {};

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
  const mobileOptions = button('', 'mobile-tool toolbar-menu', () => {
    refreshAccount(); mobileOptions.setAttribute('aria-expanded', String(app.classList.toggle('options-open')));
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
  for (const [prop, label] of [['single', '手机单列']]) {
    const wrap = node('label'), check = node('input'); check.type = 'checkbox'; check.checked = !!prefs[prop];
    check.addEventListener('change', () => { prefs[prop] = check.checked; savePrefs(); render(); });
    wrap.append(check, document.createTextNode(label)); settings.append(wrap);
  }
  /* ACCOUNT_MODULE */
  /* PROFILE_MODULE */
  const userProfiles = mountUserProfiles();
  const currentAccount = () => readCurrentAccount(window);
  const openLogin = trigger => {
    const account = currentAccount();
    if (account) {
      userProfiles.show({ ...account, author: account.username }, trigger?.nodeType === 1 ? trigger : shadow.activeElement || accountButton); return;
    }
    const login = [...document.querySelectorAll('a,button')].find(el => !el.closest('.postcontent, [id^=postcontent]') && /^(登录|登陆)$/.test(el.textContent.trim()));
    modeToggle(false);
    if (login) login.click();
  };
  const accountButton = button('登录', 'settings-login', () => openLogin(accountButton));
  const accountStatus = button('未登录', 'session-status', () => openLogin(accountStatus));
  accountStatus.setAttribute('aria-label', '未登录，登录 NGA');
  bar.insertBefore(accountStatus, mobileOptions);
  settings.append(accountButton, button('阅读设置', 'settings-reading', () => readingSettings.open()), button('原版页面 ↗', 'settings-native', () => toggle(false)));
  intro.append(heading, settings);
  const tabs = node('nav', 'tabs'); tabs.setAttribute('aria-label', '帖子筛选'); tabs.setAttribute('role', 'tablist');
  for (const [id, label] of [['all', '全部'], ['hot', '热议'], ['saved', '收藏']]) {
    const b = button(label, '', () => { tab = id; render(); }); b.dataset.tab = id; b.setAttribute('role', 'tab'); tabs.append(b);
  }
  const grid = node('section', 'grid'); grid.setAttribute('aria-label', '帖子卡片');
  const empty = node('div', 'empty'), pager = node('nav', 'pager'); pager.setAttribute('aria-label', '论坛分页');
  main.append(intro, tabs, grid, empty, pager, node('div', 'foot', '按原站顺序追加 · 热议为已加载帖子回复 ≥ 100 · 收藏仅存本浏览器'));
  app.append(top, main);
  const restore = button('卡片模式', 'restore', () => toggle(true)); restore.hidden = true;
  shadow.append(app, restore); document.documentElement.append(host);
  readingSettings = mountSettings({ context: window, shadow, app, prefs, cache: postCache, save: savePrefs, change: () => { if (prefs.smoothNavigation === false) navigation.finish(); settingsRefresh(); settings.querySelectorAll('input').forEach(c => { c.checked = !!prefs['single']; }); }, original: () => modeToggle(false), login: openLogin });
  let accountSignature;
  function refreshAccount() {
    const account = currentAccount(), signature = JSON.stringify(account);
    if (signature === accountSignature) return;
    accountSignature = signature; accountButton.replaceChildren();
    if (account) {
      accountButton.append(node('span', 'account-name', account.username), node('span', 'account-uid', `UID ${account.uid}`));
      accountButton.setAttribute('aria-label', `${account.username}，UID ${account.uid}，查看个人资料`);
    } else { accountButton.textContent = '未登录 · 登录'; accountButton.setAttribute('aria-label', '未登录，登录 NGA'); }
    accountStatus.hidden = !!account;
    readingSettings.setAccount(account);
    userProfiles.decorate(shadow.querySelector('.rt-account'), account ? { ...account, author: account.username } : null);
    userProfiles.decorate(accountButton, account ? { ...account, author: account.username } : null);
    accountChanged(account);
  }
  refreshAccount();
  const accountObserver = new MutationObserver(refreshAccount);
  accountObserver.observe(document.body, {childList:true,subtree:true,characterData:true});
  const accountTimer = window.setInterval(refreshAccount, 1000);
  window.addEventListener('pagehide', () => { accountObserver.disconnect(); window.clearInterval(accountTimer); });
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
    const readingPosition = getReadingScroll();
    prefs.enabled = enabled; savePrefs();
    app.hidden = !enabled || !items.length;
    restore.hidden = enabled || !items.length;
    setViewport(!app.hidden);
    setSurface(!app.hidden, readingPosition);
    readingSettings?.visibility(!app.hidden);
    if (!app.hidden) navigation.finish();
    if (app.hidden) cardObserver?.disconnect(); else render();
  }
  const usesDocumentScroll = () => document.documentElement.hasAttribute('data-readscape-document-scroll');
  const getReadingScroll = () => usesDocumentScroll() ? window.scrollY : app.scrollTop;
  function setReadingScroll(top) {
    if (usesDocumentScroll()) { if (window.scrollY !== top) window.scrollTo({left:0,top}); }
    else app.scrollTop = top;
  }
  function scrollReadingTo(options) { (usesDocumentScroll() ? window : app).scrollTo(options); }
  function setSurface(enabled, savedPosition) {
    const wasActive = document.documentElement.hasAttribute('data-readscape-active'), wasDocument = usesDocumentScroll();
    const position = wasActive ? savedPosition ?? getReadingScroll() : readingScroll;
    if (enabled && !wasActive) nativeScroll = { left: window.scrollX, top: window.scrollY };
    if (!enabled && wasActive) readingScroll = position;
    const documentScroll = enabled && !!mobileViewport?.matches;
    document.documentElement.toggleAttribute('data-readscape-active', enabled);
    document.documentElement.toggleAttribute('data-readscape-document-scroll', documentScroll);
    app.classList.toggle('document-scroll', documentScroll);
    document.documentElement.style.overflow = enabled ? documentScroll ? 'auto' : 'hidden' : originalOverflow;
    if (enabled && (!wasActive || documentScroll !== wasDocument)) {
      app.classList.remove('rt-chrome-hidden');
      setReadingScroll(position);
    }
    if (!enabled && nativeScroll) {
      if (window.scrollX !== nativeScroll.left || window.scrollY !== nativeScroll.top) window.scrollTo(nativeScroll);
      nativeScroll = null;
    }
  }
  const updateScrollMode = () => { if (!app.hidden) { setSurface(true); observeListEnd(); } };
  mobileViewport?.addEventListener('change', updateScrollMode);
  let chromeScroll = 0;
  const updateReadingChrome = () => {
    if (!usesDocumentScroll() || document.documentElement.hasAttribute('data-readscape-reader-open')) return;
    const top = window.scrollY, delta = top - chromeScroll;
    if (top < 90 || Math.abs(delta) >= 12) {
      app.classList.toggle('rt-chrome-hidden', top >= 90 && delta > 0 && !app.classList.contains('options-open'));
      chromeScroll = top;
    }
  };
  window.addEventListener('scroll', updateReadingChrome, {passive:true});
  window.addEventListener('pagehide', () => { mobileViewport?.removeEventListener('change', updateScrollMode); window.removeEventListener('scroll', updateReadingChrome); });
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
  if (window.top === window.self && typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('切换 NGA 阅读 / 原版', () => modeToggle(!prefs.enabled));
  }

  /* LIST_MODULE */

  // 封面直接引用原图地址，由浏览器 HTTP 缓存承担复用；缓存只记录地址。
  function applyCachedCover(card, tid) {
    if (!postCache || card.coverLoading) return;
    card.coverLoading = true;
    const generation = postCache.generation;
    postCache.getCover(tid).then(cached => {
      if (!cached || coverDisposed || generation !== postCache.generation || !card.isConnected) return;
      const cover = card.querySelector('.cover');
      if (!cover || card.coverSource === cached.source) return;
      const image = node('img'); image.alt = ''; image.decoding = 'async'; image.loading = 'lazy';
      // 已有比例时先占位，避免图片加载后卡片高度变化导致滚动中点击偏移。
      if (cached.width > 0 && cached.height > 0) image.style.aspectRatio = `${cached.width} / ${cached.height}`;
      // 立即入树：lazy 图片脱离文档不会触发加载；比例已占位，加载前后布局不变。
      image.className = 'cached-cover-image';
      image.onerror = () => { image.remove(); cover.classList.remove('cached-cover'); card.coverSource = null; };
      cover.querySelector('.cached-cover-image')?.remove();
      cover.prepend(image); cover.classList.add('cached-cover'); card.coverSource = cached.source;
      image.src = cached.source;
      if (image.naturalWidth > 0 && image.naturalHeight > 0 && !image.style.aspectRatio) image.style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
    }).catch(() => {}).finally(() => { card.coverLoading = false; });
  }
  const unsubscribeCache = postCache?.subscribe(event => {
    if (event.type === 'cover') { const card = listCards.get(event.tid)?.card; if (card) applyCachedCover(card, event.tid); }
    if (event.type === 'clear') {
      for (const {card} of listCards.values()) { card.querySelector('.cached-cover-image')?.remove(); card.querySelector('.cover')?.classList.remove('cached-cover'); card.coverSource = null; }
    }
    if (event.type === 'favorites') postCache.getFavorites().then(saved => {
      if (!saved || coverDisposed) return;
      for (const tid of Object.keys(favorites)) if (!saved[tid]) delete favorites[tid]; Object.assign(favorites,saved);
      if (!app.classList.contains('reader') && items.length) render(false);
    });
  });
  postCache?.getFavorites().then(saved => {
    if (!saved || coverDisposed) return;
    for (const [tid,item] of Object.entries(saved)) if (!favoriteChanges.has(tid)) favorites[tid] = item;
    if (!app.classList.contains('reader') && items.length) render(false);
  });
  window.addEventListener('pagehide', event => { if (event.persisted) return; coverDisposed = true; unsubscribeCache?.(); });

  function extract(doc = document, base = pageURL.href) {
    const result = [], seen = new Set();
    // 优先常见 NGA topic 类，同时兼容 table / li 列表；不依赖数字化动态 ID。
    for (const a of [...doc.querySelectorAll('a.topic, a[id^="t_tt"], .c2 > a[href*="read.php"]'), ...doc.querySelectorAll('a[href*="read.php"]')]) {
      if (a.matches('.replydate,.replies,.reply') || a.closest('.c1,.c4,[id^="t_pc"]')) continue;
      const u = safeURL(a.getAttribute('href'), base);
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
      const pageLinks = [...row.querySelectorAll('a[href*="read.php"]')].map(x => safeURL(x.getAttribute('href'), base)).filter(x => x?.origin === u.origin && x.searchParams.get('tid') === tid);
      const replyURL = safeURL(row.querySelector('a.replydate')?.getAttribute('href') || '', base);
      const lastURL = replyURL?.origin === u.origin && replyURL.searchParams.get('tid') === tid ? replyURL : pageLinks.sort((x, y) => Number(y.searchParams.get('page') || 1) - Number(x.searchParams.get('page') || 1))[0];
      u.searchParams.delete('page'); u.hash = '';
      const authorURL = safeURL(users[0]?.getAttribute('href') || '', base);
      const uid = authorURL?.searchParams.get('uid') || null;
      result.push({ tid, title, author, uid, replies, time: timeMatch?.[0] || '', url: u.href, latest: lastURL?.href || '', pinned: /置顶/.test(title) || /(?:^|\s)(?:top|sticky)(?:\s|$)/i.test(row.className) });
    }
    return result;
  }

  function scan() {
    autoContinue();
    const found = extract();
    const sig = JSON.stringify(found);
    if (sig === signature) return;
    signature = sig;
    if (!found.length && !items.length) {
      app.hidden = restore.hidden = true;
      readingSettings.visibility(false);
      setSurface(false);
      setViewport(false);
      return;
    }
    if (found.length) updateListPage(found);
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
    pager.append(listLoad, listStatus, button('原版翻页', 'pill', () => toggle(false)));
    updateListControls();
  }

  const palette = ['#f5e7df', '#e5ebdf', '#e7e8f3', '#f5e5e8', '#e0edef', '#f2eddf'];
  const color = tid => palette[Number(tid.slice(-4)) % palette.length];
  const count = n => n == null ? '讨论' : n >= 10000 ? `${(n / 10000).toFixed(1)}万回复` : `${n} 回复`;

  function render(cacheVisit = true) {
    grid.classList.toggle('single', !!prefs.single);
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    // 收藏包含曾浏览过的其他页；全部与热议保持已加载页面的原始顺序。
    const source = tab === 'saved' ? Object.values(favorites) : items;
    const visible = source.filter(item => (tab !== 'hot' || item.replies >= 100) && (!query || `${item.title} ${item.author}`.toLowerCase().includes(query)));
    if (cacheVisit) postCache?.visit(visible);
    subtitle.textContent = `第 ${firstListPage}${listPages.size > 1 ? `–${listCursor}` : ''} 页 · ${visible.length} 篇${query ? ' · 已加载搜索' : ''}`;
    empty.textContent = tab === 'saved' ? '点击卡片上的 ♡ 收藏帖子。' : '没有符合条件的帖子。';
    empty.hidden = visible.length > 0;
    const retained = new Set(visible.map(item => item.tid));
    for (const card of [...grid.children]) if (!retained.has(card.dataset.tid)) { cardObserver?.unobserve(card); card.remove(); }
    for (const [index, item] of visible.entries()) {
      const { lastAccess, updatedAt, contentHtml, coverId, ...appearance } = item;
      const signature = JSON.stringify(appearance);
      let entry = listCards.get(item.tid);
      if (!entry || entry.signature !== signature) {
        const card = makeCard(item);
        if (entry?.card.isConnected) { cardObserver?.unobserve(entry.card); entry.card.replaceWith(card); }
        entry = { card, signature }; listCards.set(item.tid, entry);
      }
      const fav = entry.card.querySelector('.save'), saved = !!favorites[item.tid];
      fav.textContent = saved ? '♥' : '♡'; fav.setAttribute('aria-pressed', String(saved));
      if (grid.children[index] !== entry.card) grid.insertBefore(entry.card, grid.children[index] || null);
      if (!entry.card.coverSource) applyCachedCover(entry.card, item.tid);
    }
    // 保留 DOM 中的原站顺序，按实际高度跨网格行，避免短卡片下方留白。
    if (typeof window.ResizeObserver === 'function') {
      cardObserver ||= new window.ResizeObserver(entries => {
        for (const { target } of entries) {
          const span = Math.ceil((target.getBoundingClientRect().height + 18) / 4);
          target.style.gridRowEnd = `span ${Math.max(1, span)}`;
        }
      });
      grid.classList.add('masonry');
      for (const card of grid.children) cardObserver.observe(card);
    }
    updateListControls();
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
    const avatar = button(item.author.slice(0, 1) || 'N', 'avatar user-trigger', () => userProfiles.show(item, avatar));
    const author = button(item.author || '作者未识别', 'author user-trigger', () => userProfiles.show(item, author));
    userProfiles.decorate(avatar, item, true);
    person.append(avatar, author);
    const saved = !!favorites[item.tid];
    const fav = button(saved ? '♥' : '♡', 'save', () => {
      if (favorites[item.tid]) delete favorites[item.tid]; else favorites[item.tid] = { ...item };
      favoriteChanges.add(item.tid); postCache?.setFavorite(item, !!favorites[item.tid]);
      const state = !!favorites[item.tid]; fav.textContent = state ? '♥' : '♡'; fav.setAttribute('aria-pressed', String(state));
      if (tab === 'saved') render();
    });
    fav.setAttribute('aria-label', '收藏帖子'); fav.setAttribute('aria-pressed', String(saved)); person.append(fav);
    const meta = node('div', 'meta'); meta.append(node('span', '', count(item.replies)), node('span', '', item.time));
    if (item.latest && item.latest !== item.url && new URL(item.latest).searchParams.has('page')) meta.append(link(item.latest, '最新回复', 'latest'));
    body.append(person, meta); card.append(cover, body);
    return card;
  }

  /* BBCODE_MODULE */
  /* READER_MODULE */
  if (/\/read\.php$/.test(pageURL.pathname)) { startReader(); return; }
  scan();
  // 列表由 NGA 后续脚本生成时再扫描，不覆盖登录/错误页。
  const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 220); });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  observeListEnd();
  window.addEventListener('pagehide', () => { observer.disconnect(); cardObserver?.disconnect(); listObserver?.disconnect(); listController?.abort(); clearTimeout(timer); clearTimeout(gateTimer); });
}
