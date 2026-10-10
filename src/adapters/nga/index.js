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
  const initialListPageParam = pageURL.pathname === '/thread.php' ? (Number(pageURL.searchParams.get('page')) || 1) : 1;
  const hasNonFirstPage = initialListPageParam > 1;
  if (hasNonFirstPage) {
    pageURL.searchParams.delete('page');
    if (prefs.enabled !== false && typeof history?.replaceState === 'function') {
      try { history.replaceState(history.state, '', pageURL.href); } catch {}
    }
  }
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
    html[data-readscape-active][data-rt-theme=paper]{background:#f6f2e9!important}
    html[data-readscape-active][data-rt-theme=dark]{background:#17191d!important;color-scheme:dark}
    html[data-readscape-active]>body{display:none!important}
    html[data-readscape-active]::before,html[data-readscape-active]::after{display:none!important}
    html[data-readscape-active]>#nga-cards-host{all:initial!important;display:block!important;position:fixed!important;inset:0!important;width:100%!important;height:100%!important;height:100dvh!important;z-index:2147483000!important;isolation:isolate!important}
    html[data-readscape-document-scroll]{overflow-x:clip!important;overflow-y:auto!important;height:auto!important;min-height:100%!important;overscroll-behavior-y:auto!important}
    html[data-readscape-document-scroll]>#nga-cards-host{position:relative!important;inset:auto!important;height:auto!important;min-height:100svh!important;contain:none!important}
    html[data-readscape-reader-open],html[data-readscape-modal-open]{overflow:hidden!important;overscroll-behavior:none!important}
    html[data-readscape-modal-open]>body{overflow:hidden!important;touch-action:none!important}
  `;
  document.head.append(surfaceStyle);
  const originalViewport = document.querySelector('meta[name="viewport"]');
  const originalViewportContent = originalViewport?.getAttribute('content');
  const viewport = originalViewport || document.createElement('meta');
  viewport.name = 'viewport';
  let items = [], tab = 'all', query = '', signature = '', timer;
  const isForumRoot = /^\/(?:index\.php|forum\.php)?$/.test(pageURL.pathname) && !pageURL.searchParams.has('fid') && !pageURL.searchParams.has('stid') && !pageURL.searchParams.has('tid');
  let cardObserver, listObserver;
  const listCards = new Map();
  let coverDisposed = false, readerApp = null, activeClickedTid = null;
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
  const app = node('div', 'app'); app.hidden = true; app.tabIndex = -1;
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
    refreshAccount();
    const open = app.classList.toggle('options-open');
    mobileOptions.setAttribute('aria-expanded', String(open));
    readingSettings?.open(mobileOptions);
  }); mobileOptions.setAttribute('aria-label', '展开或收起设置'); mobileOptions.setAttribute('aria-expanded', 'false');
  for (const [control, path] of [[mobileSearch, 'M21 21l-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0'], [mobileOptions, 'M5 6h14M5 12h14M5 18h14']]) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '21'); svg.setAttribute('height', '21'); svg.setAttribute('aria-hidden', 'true');
    shape.setAttribute('d', path); shape.setAttribute('fill', 'none'); shape.setAttribute('stroke', 'currentColor'); shape.setAttribute('stroke-width', '1.7'); shape.setAttribute('stroke-linecap', 'round');
    svg.append(shape); control.append(svg);
  }
  const boardBarBtn = link('/index.php', '板块', 'board-bar-btn');
  boardBarBtn.setAttribute('aria-label', '前往论坛首页选择板块');
  boardBarBtn.addEventListener('click', e => {
    if (e.isTrusted === false && typeof boardsManager?.open === 'function') {
      e.preventDefault();
      boardsManager.open();
    }
  });
  bar.append(brand, search, node('div', 'spacer'), boardBarBtn, mobileSearch, mobileOptions, button('切回原版', 'pill', () => toggle(false)));
  top.append(bar);
  const main = node('main'), intro = node('div', 'intro'), heading = node('div', 'intro-heading');
  const h1 = node('h1', 'board-title', '');
  const h1Text = node('span', 'board-title-text', '论坛发现');
  const switchBadge = link('/index.php', '切换 ↗', 'board-title-switch');
  switchBadge.setAttribute('aria-label', '前往论坛首页切换板块');
  switchBadge.addEventListener('click', e => {
    if (e.isTrusted === false && typeof boardsManager?.open === 'function') {
      e.preventDefault();
      boardsManager.open();
    }
  });
  h1.append(h1Text, switchBadge);
  h1.addEventListener('click', event => {
    if (event.target !== switchBadge) {
      if (isForumRoot) return;
      if (event.isTrusted === false && typeof boardsManager?.open === 'function') boardsManager.open();
      else location.href = '/index.php';
    }
  });
  const subtitle = node('div', 'sub');
  heading.append(h1, subtitle);
  const subforumStrip = node('nav', 'subforum-strip');
  subforumStrip.setAttribute('aria-label', '当前板块子版块导航');
  subforumStrip.hidden = true;
  const settings = node('div', 'settings');
  for (const [prop, label] of [['single', '手机单列']]) {
    const wrap = node('label'), check = node('input'); check.type = 'checkbox'; check.checked = !!prefs[prop];
    check.addEventListener('change', () => { prefs[prop] = check.checked; savePrefs(); render(); });
    wrap.append(check, document.createTextNode(label)); settings.append(wrap);
  }
  /* ACCOUNT_MODULE */
  /* PROFILE_MODULE */
  /* BOARDS_MODULE */
  const boardsManager = mountBoardsManager({ context: window, shadow, app, pageURL, prefs, savePrefs });
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
  settings.append(accountButton, button('切换板块', 'settings-boards', () => boardsManager.open()), button('阅读设置', 'settings-reading', () => readingSettings.open()), button('原版页面 ↗', 'settings-native', () => toggle(false)));
  intro.append(heading, settings);
  const tabs = node('nav', 'tabs'); tabs.setAttribute('aria-label', '帖子筛选'); tabs.setAttribute('role', 'tablist');
  for (const [id, label] of [['all', '全部'], ['hot', '热议'], ['saved', '收藏']]) {
    const b = button(label, '', () => { tab = id; render(); }); b.dataset.tab = id; b.setAttribute('role', 'tab'); tabs.append(b);
  }
  const grid = node('section', 'grid'); grid.setAttribute('aria-label', '帖子卡片');
  // 手势期间只收集更新，避免按下与抬手之间改变卡片几何位置。
  let listInteraction = false;
  for (const type of ['wheel', 'touchstart', 'keydown', 'click']) app.addEventListener(type, () => { listInteraction = true; markListActivity(); }, { passive: true, capture: true });
  // 链接的原生聚焦可能把半露出的卡片滚入视口。保留聚焦与点击语义，禁止聚焦滚动。
  grid.addEventListener('mousedown', event => {
    const cover = event.target.closest?.('a.cover');
    if (!cover || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); cover.focus({ preventScroll: true });
  });
  grid.addEventListener('click', event => {
    const cover = event.target.closest?.('a.cover');
    const card = cover?.closest?.('.card');
    if (card?.dataset?.tid) activeClickedTid = card.dataset.tid;
  }, { capture: true });
  const empty = node('div', 'empty'), pager = node('nav', 'pager'); pager.setAttribute('aria-label', '论坛分页');
  main.append(intro, subforumStrip, tabs, grid, empty, pager, node('div', 'foot', '按原站顺序追加 · 热议为已加载帖子回复 ≥ 100 · 收藏仅存本浏览器'));
  app.append(top, main);
  const restore = button('卡片模式', 'restore', () => toggle(true)); restore.hidden = true;
  shadow.append(app, restore); document.documentElement.append(host);
  readingSettings = mountSettings({ context: window, shadow, app, prefs, cache: postCache, save: savePrefs, change: () => { if (prefs.smoothNavigation === false) navigation.finish(); settingsRefresh(); if (!app.classList.contains('reader')) configureListRefresh(); settings.querySelectorAll('input').forEach(c => { c.checked = !!prefs['single']; }); }, original: () => modeToggle(false), login: openLogin, openBoards: () => boardsManager?.open() });
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

  // 整页就是闸门页时的兜底：仅点击 NGA 已提供的普通跳转链接；不调用未公开接口，
  // 不点击登录或验证按钮。后台请求遇到的偶发闸门已在数据层用通行证自愈。
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
    app.hidden = !enabled || (!items.length && !listBootPending && !isForumRoot);
    restore.hidden = enabled || (!items.length && !isForumRoot);
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
    if (!usesDocumentScroll() || document.documentElement.hasAttribute('data-readscape-reader-open') || document.documentElement.hasAttribute('data-readscape-modal-open')) return;
    const top = window.scrollY, delta = top - chromeScroll;
    if (top < 90 || Math.abs(delta) >= 12) {
      app.classList.toggle('rt-chrome-hidden', top >= 90 && delta > 0 && !app.classList.contains('options-open'));
      chromeScroll = top;
    }
  };
  function canScrollVertically(el, direction) {
    const currentApp = (readerApp && !readerApp.hidden) ? readerApp : app;
    if (!el || el === currentApp || el === document.body || el === document.documentElement) return false;
    const style = window.getComputedStyle?.(el);
    if (!style) return false;
    const overflowY = style.overflowY;
    if (overflowY !== 'auto' && overflowY !== 'scroll') return false;
    if (direction > 0) {
      return el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    } else {
      return el.scrollTop > 1;
    }
  }
  function handleKeyScroll(event) {
    if (event.defaultPrevented) return;
    const currentApp = (readerApp && !readerApp.hidden) ? readerApp : app;
    if (usesDocumentScroll() || currentApp.hidden || document.documentElement.hasAttribute('data-readscape-reader-open') || document.documentElement.hasAttribute('data-readscape-modal-open')) return;
    if (shadow.querySelector('dialog[open]')) return;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    const target = path[0] || event.target;
    if (target) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      if (tag === 'BUTTON' && (event.key === ' ' || event.key === 'Spacebar')) return;
    }
    if (event.ctrlKey || event.altKey) return;
    let delta = 0, toTop = false, toBottom = false;
    if (event.metaKey) {
      if (event.key === 'ArrowUp') toTop = true;
      else if (event.key === 'ArrowDown') toBottom = true;
      else return;
    } else {
      switch (event.key) {
        case 'ArrowDown': delta = 80; break;
        case 'ArrowUp': delta = -80; break;
        case 'PageDown': delta = Math.max(100, (currentApp.clientHeight || 600) - 60); break;
        case 'PageUp': delta = -Math.max(100, (currentApp.clientHeight || 600) - 60); break;
        case ' ':
        case 'Spacebar': delta = event.shiftKey ? -Math.max(100, (currentApp.clientHeight || 600) - 60) : Math.max(100, (currentApp.clientHeight || 600) - 60); break;
        case 'Home': toTop = true; break;
        case 'End': toBottom = true; break;
        default: return;
      }
    }
    const direction = toBottom ? 1 : toTop ? -1 : delta;
    for (const node of path) {
      if (node === currentApp) break;
      if (node && node.nodeType === 1 && canScrollVertically(node, direction)) return;
    }
    event.preventDefault();
    listInteraction = true;
    if (typeof markListActivity === 'function') markListActivity();
    if (toTop) currentApp.scrollTop = 0;
    else if (toBottom) currentApp.scrollTop = currentApp.scrollHeight;
    else currentApp.scrollTop += delta;
  }
  window.addEventListener('keydown', handleKeyScroll, { passive: false });
  window.addEventListener('scroll', updateReadingChrome, {passive:true});
  window.addEventListener('pagehide', () => { mobileViewport?.removeEventListener('change', updateScrollMode); window.removeEventListener('scroll', updateReadingChrome); window.removeEventListener('keydown', handleKeyScroll); });
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

  function getGridColumns() {
    const raw = window.getComputedStyle(grid).gridTemplateColumns.trim();
    const repeatMatch = raw.match(/repeat\(\s*(\d+)\s*,/i);
    if (repeatMatch) return Math.max(1, parseInt(repeatMatch[1], 10));
    const tracks = raw.split(/\s+/).filter(t => t && !t.startsWith('repeat') && !t.startsWith('minmax'));
    return Math.max(1, tracks.length);
  }

  // 每张卡片固定所在列，列内按实测高度累加。自动网格排位会因某张卡片增高
  // 把后续卡片换到另一列；显式行列位置让封面、字体加载与追加只影响所在列。
  function layoutMasonry() {
    if (!grid.isConnected || !grid.classList.contains('masonry')) return;
    if (app.hidden || app.style.display === 'none') return;
    const columns = getGridColumns();
    const rows = Array(columns).fill(1);
    const cards = [...grid.children];
    cards.forEach((card, index) => { card.style.gridColumn = String(index % columns + 1); });
    const spans = cards.map(card => Math.max(1, Math.ceil(((card.getBoundingClientRect().height || card.offsetHeight) + 18) / 4)));
    cards.forEach((card, index) => {
      const column = index % columns;
      const start = String(rows[column]), end = `span ${spans[index]}`;
      if (card.style.gridRowStart !== start) card.style.gridRowStart = start;
      if (card.style.gridRowEnd !== end) card.style.gridRowEnd = end;
      rows[column] += spans[index];
    });
  }
  function sizeCard(card) { if (card?.isConnected) layoutMasonry(); }

  // 封面直接引用原图地址，由浏览器 HTTP 缓存承担复用；缓存只记录地址。
  function applyCachedCover(card, tid) {
    if (!postCache || card.coverLoading) return;
    card.coverLoading = true;
    const generation = postCache.generation;
    postCache.getCover(tid).then(cached => {
      if (!cached || coverDisposed || generation !== postCache.generation || !card.isConnected) return;
      if (card.coverSignature === JSON.stringify([cached.source, cached.width || 0, cached.height || 0])) return;
      if (listInteraction || readerCoversList() || isCardInView(card) || card.dataset.tid === activeClickedTid) queueListCover(card, cached);
      else setCardCover(card, cached);
    }).catch(() => {}).finally(() => { card.coverLoading = false; });
  }
  function setCardCover(card, cached) {
    const cover = card.querySelector('.cover');
    if (!cover || card.coverSignature === JSON.stringify([cached.source, cached.width || 0, cached.height || 0])) return;
    const image = node('img'); image.alt = ''; image.decoding = 'async'; image.loading = 'lazy';
    // 已有比例时先占位，避免图片加载后卡片高度变化导致滚动中点击偏移。
    if (cached.width > 0 && cached.height > 0) image.style.aspectRatio = `${cached.width} / ${cached.height}`;
    // 立即入树：lazy 图片脱离文档不会触发加载；比例已占位，加载前后布局不变。
    image.className = 'cached-cover-image';
    image.onerror = () => { image.onerror = null; image.removeAttribute('src'); image.alt = '封面暂时不可用'; image.classList.add('cover-image-error'); };
    // 无占位比例时图片加载完才增高，加载后补算一次跨度。
    image.addEventListener('load', () => sizeCard(card), { once: true });
    cover.querySelector('.cached-cover-image')?.remove();
    cover.prepend(image); cover.classList.add('cached-cover'); card.coverSource = cached.source; card.coverSignature = JSON.stringify([cached.source, cached.width || 0, cached.height || 0]);
    image.src = cached.source;
    if (image.naturalWidth > 0 && image.naturalHeight > 0 && !image.style.aspectRatio) image.style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
    // 占位比例已确定高度，立即重算跨度，避免与下方卡片重叠。
    sizeCard(card);
  }
  const unsubscribeCache = postCache?.subscribe(event => {
    if (event.type === 'cover') { const card = listCards.get(event.tid)?.card; if (card) applyCachedCover(card, event.tid); }
    if (event.type === 'clear') {
      pendingListCovers.clear();
      for (const {card} of listCards.values()) { card.querySelector('.cached-cover-image')?.remove(); card.querySelector('.cover')?.classList.remove('cached-cover'); card.coverSource = null; card.coverSignature = null; }
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

  /* API_MODULE */
  const ngaApi = createNGAApi({ pageURL, safeURL });
  const extract = ngaApi.extractTopics;

  function scan() {
    autoContinue();
    if (listBootPending) return;
    if (isForumRoot) {
      h1Text.textContent = '选择论坛板块';
      subtitle.textContent = 'NGA 拥有众多精彩子论坛，请选择您想浏览的板块';
      switchBadge.hidden = true;
      subforumStrip.hidden = true;
      tabs.hidden = true;
      grid.hidden = true;
      pager.hidden = true;
      if (typeof refreshBar !== 'undefined') refreshBar.hidden = true;
      boardsManager.renderPortalView(main, empty);
      toggle(prefs.enabled !== false);
      return;
    }
    const found = extract();
    const sig = JSON.stringify([found, nextListURL(document, firstListPage, pageURL.href)]);
    if (sig === signature) return;
    signature = sig;
    if (!found.length && !items.length) {
      app.hidden = restore.hidden = true;
      readingSettings.visibility(false);
      setSurface(false);
      setViewport(false);
      return;
    }
    if (found.length && !hasNonFirstPage) updateListPage(found);
    updateListHeading();
    toggle(prefs.enabled !== false);
    renderPager();
    observeListEnd();
  }

  function updateListHeading() {
    if (isForumRoot) {
      switchBadge.hidden = true;
      subforumStrip.hidden = true;
      return;
    }
    const info = boardsManager.detectBoardInfo(document, window, pageURL);
    h1Text.textContent = info.name;
    switchBadge.hidden = false;
    boardsManager.recordRecentBoard({ fid: info.fid, stid: info.stid, name: info.name, url: location.href });
    boardsManager.renderSubforumStrip(subforumStrip);
  }

  function renderPager() {
    pager.replaceChildren();
    pager.append(listLoad, listStatus, button('原版翻页', 'pill', () => toggle(false)));
    updateListControls();
  }

  const palette = ['#f5e7df', '#e5ebdf', '#e7e8f3', '#f5e5e8', '#e0edef', '#f2eddf'];
  const color = tid => palette[Number(tid.slice(-4)) % palette.length];
  const count = n => n == null ? '讨论' : n >= 10000 ? `${(n / 10000).toFixed(1)}万回复` : `${n} 回复`;

  // 列表滚动位置跨整页加载保留。平滑阅读用 iframe 覆盖列表、位置天然不动；但整页
  // 跳转 / 刷新 / 新标签打开时列表会重建，而卡片是异步渲染的——浏览器原生滚动恢复
  // 触发那一刻页面还很短，会被夹回顶部。于是自己按列表地址存一份，返回或刷新后等
  // 卡片把高度撑起来再滚回去，做到"从哪来回哪去"。
  const listNavType = (() => {
    const nav = window.performance?.getEntriesByType?.('navigation')?.[0];
    if (nav?.type) return nav.type;
    const legacy = window.performance?.navigation?.type;
    return legacy === 2 ? 'back_forward' : legacy === 1 ? 'reload' : 'navigate';
  })();
  let listScrollRestored = false, listScrollTries = 0, listScrollSaveTimer;
  const listScrollKey = () => `${KEY}-scroll-${streamKey}#${firstListPage}`;
  function saveListScroll() {
    // 阅读态由 navigation 自己记住列表位置；此处只在浏览列表时记录，避免覆盖成阅读页的滚动。
    if (!streamKey || document.documentElement.hasAttribute('data-readscape-reader-open')) return;
    try { sessionStorage.setItem(listScrollKey(), JSON.stringify({ y: Math.round(getReadingScroll()), at: Date.now() })); } catch { /* 存储被禁用时忽略 */ }
  }
  function cancelListRestore() { listScrollRestored = true; }
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) app.addEventListener(type, cancelListRestore, { passive: true, capture: true });
  function restoreListScroll() {
    if (listScrollRestored || !streamKey || app.hidden) return;
    if (listNavType !== 'back_forward' && listNavType !== 'reload') { listScrollRestored = true; return; }
    let saved; try { saved = JSON.parse(sessionStorage.getItem(listScrollKey()) || 'null'); } catch { saved = null; }
    if (!saved || !(saved.y > 0) || Date.now() - saved.at > 30 * 60000) { listScrollRestored = true; return; }
    // 高度不足时先等待，卡片渲染 / 翻页 hydrate 完成后才能滚到目标位置。
    const room = usesDocumentScroll() ? document.documentElement.scrollHeight - window.innerHeight : app.scrollHeight - app.clientHeight;
    if (room < saved.y - 4 && listScrollTries++ < 50) { window.setTimeout(restoreListScroll, 60); return; }
    listScrollRestored = true;
    setReadingScroll(saved.y);
  }
  window.addEventListener('scroll', () => {
    if (listScrollSaveTimer) return;
    listScrollSaveTimer = window.setTimeout(() => { listScrollSaveTimer = null; saveListScroll(); }, 250);
  }, { passive: true });
  window.addEventListener('pagehide', saveListScroll);

  function render(cacheVisit = true) {
    if (isForumRoot) return;
    grid.classList.toggle('single', !!prefs.single);
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    // 收藏包含曾浏览过的其他页；全部与热议保持已加载页面的原始顺序。
    const source = tab === 'saved' ? Object.values(favorites) : items;
    const visible = source.filter(item => (tab !== 'hot' || item.replies >= 100) && (!query || `${item.title} ${item.author}`.toLowerCase().includes(query)));
    if (cacheVisit && !listBootPending) postCache?.visit(listFromCache || pendingListPage ? visible.map(({tid}) => ({tid})) : visible);
    subtitle.textContent = `第 ${firstListPage}${listPages.size > 1 ? `–${listCursor}` : ''} 页 · ${visible.length} 篇${query ? ' · 已加载搜索' : ''}`;
    empty.textContent = listBootPending ? '正在准备列表…' : tab === 'saved' ? '点击卡片上的 ♡ 收藏帖子。' : '没有符合条件的帖子。';
    empty.hidden = visible.length > 0;
    const retained = new Set(visible.map(item => item.tid));
    for (const card of [...grid.children]) if (!retained.has(card.dataset.tid)) { cardObserver?.unobserve(card); card.remove(); }
    for (const [index, item] of visible.entries()) {
      const { lastAccess, updatedAt, contentHtml, coverId, ...appearance } = item;
      const signature = JSON.stringify(appearance);
      let entry = listCards.get(item.tid);
      if (entry && entry.signature !== signature) {
        updateCard(entry.card, item); entry.signature = signature;
      }
      if (!entry) {
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
      cardObserver ||= new window.ResizeObserver(layoutMasonry);
      grid.classList.add('masonry');
      layoutMasonry();
      cardObserver.observe(grid);
      for (const card of grid.children) cardObserver.observe(card);
    }
    updateListControls();
    restoreListScroll();
  }

  function makeCard(item) {
    const card = node('article', 'card'); card.item = item; card.classList.add('card-enter'); card.addEventListener('animationend', () => card.classList.remove('card-enter'), { once: true }); card.dataset.tid = item.tid; card.style.setProperty('--bg', color(item.tid));
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
      fav.classList.remove('save-pop'); void fav.offsetWidth; fav.classList.add('save-pop');
      const state = !!favorites[item.tid]; fav.textContent = state ? '♥' : '♡'; fav.setAttribute('aria-pressed', String(state));
      if (tab === 'saved') render();
    });
    fav.setAttribute('aria-label', '收藏帖子'); fav.setAttribute('aria-pressed', String(saved)); person.append(fav);
    const meta = node('div', 'meta'); meta.append(node('span', '', count(item.replies)), node('span', '', item.time));
    if (item.latest && item.latest !== item.url && new URL(item.latest).searchParams.has('page')) meta.append(link(item.latest, '最新回复', 'latest'));
    body.append(person, meta); card.append(cover, body);
    if (item.coverId && safeURL(item.coverId)) setCardCover(card, { source: item.coverId, width: item.coverW, height: item.coverH });
    return card;
  }

  function updateCard(card, incoming) {
    Object.assign(card.item, incoming);
    card.querySelector('.title').textContent = incoming.title;
    card.querySelector('.author').textContent = incoming.author || '作者未识别';
    card.querySelector('.avatar').textContent = incoming.author.slice(0, 1) || 'N';
    card.querySelector('.cover').href = incoming.url;
    const eye = card.querySelector('.eyebrow'); eye.replaceChildren(document.createTextNode('NGA · 讨论'));
    if (incoming.pinned || incoming.replies >= 100) eye.append(node('span', 'tag', incoming.pinned ? '置顶' : '热议'));
    const meta = card.querySelector('.meta'); meta.replaceChildren(node('span', '', count(incoming.replies)), node('span', '', incoming.time));
    if (incoming.latest && incoming.latest !== incoming.url && new URL(incoming.latest).searchParams.has('page')) meta.append(link(incoming.latest, '最新回复', 'latest'));
  }

  /* BBCODE_MODULE */
  /* READER_MODULE */
  if (/\/read\.php$/.test(pageURL.pathname)) { startReader(); return; }

  let savedListScroll = 0, savedListTitle = '', activeReaderInstance = null, currentReaderURL = null, activeReaderTitle = '', currentOpener = null;
  let activeSPAController = null;

  function canUseSPA() {
    return typeof window.fetch === 'function' && prefs.enabled !== false && prefs.smoothNavigation !== false && prefs.spaReader !== false;
  }

  function openReaderSPA(url, restoring = false, opener = null) {
    if (!canUseSPA()) return false;
    currentOpener = opener;
    const tid = url.searchParams.get('tid');
    if (!tid) return false;
    activeClickedTid = tid;

    if (activeSPAController) {
      activeSPAController.abort();
      activeSPAController = null;
    }

    if (restoring && activeReaderInstance && currentReaderURL?.href === url.href && readerApp) {
      shadow.querySelector('.spa-loading-notice')?.remove();
      app.style.display = 'none';
      app.inert = true;
      readerApp.style.display = '';
      readerApp.hidden = false;
      document.title = activeReaderTitle || document.title;
      readerApp.focus({ preventScroll: true });
      return true;
    }

    let notice = shadow.querySelector('.spa-loading-notice');
    if (!notice) {
      notice = node('div', 'spa-loading-notice', '正在加载帖子…');
      notice.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:2147483015;padding:8px 20px;border-radius:20px;background:#fff;color:#ff2442;box-shadow:0 4px 20px #00000026;font:13px system-ui;font-weight:600;display:flex;align-items:center;gap:8px;pointer-events:none;animation:card-appear .2s ease-out';
      shadow.append(notice);
    }

    const controller = new AbortController();
    activeSPAController = controller;
    const fetchTimeout = setTimeout(() => controller.abort(), 12000);

    ngaApi.fetchThreadDoc(url.href, { signal: controller.signal })
      .then(({ doc }) => {
        clearTimeout(fetchTimeout);
        if (activeSPAController === controller) activeSPAController = null;
        notice?.remove();

        if (ngaApi.isDeletedDoc(doc)) {
          document.dispatchEvent(new (window.CustomEvent || CustomEvent)('readscape-post-deleted', {
            detail: { tid, url: url.href, reason: '帖子被删除' }
          }));
          return;
        }

        // fetchDoc 已经捡过 guestJs 通行证重试；仍拿不到正文就退回整页流程，
        // 交给原页自己的跳转与登录提示接手。
        if (ngaApi.isVisitorGate(doc) || !ngaApi.hasThreadContent(doc)) {
          location.assign(url.href);
          return;
        }

        activateSPAReader(url, doc, opener);
      })
      .catch(err => {
        clearTimeout(fetchTimeout);
        if (activeSPAController === controller) activeSPAController = null;
        notice?.remove();
        if (err?.name === 'AbortError') return;
        location.assign(url.href);
      });

    return true;
  }

  function activateSPAReader(url, doc, opener) {
    shadow.querySelector('.spa-loading-notice')?.remove();
    if (!readerApp) {
      readerApp = node('div', 'app reader');
      readerApp.tabIndex = -1;
      shadow.append(readerApp);
    }
    currentOpener = opener;
    currentReaderURL = url;
    savedListScroll = getReadingScroll();
    savedListTitle = document.title;

    app.style.display = 'none';
    app.inert = true;

    readerApp.style.display = '';
    readerApp.hidden = false;

    history.pushState({ readscapeSPA: true, tid: url.searchParams.get('tid'), listURL: location.href }, '', url.href);

    activeReaderInstance = startReader({
      targetURL: url,
      container: readerApp,
      initialDoc: doc,
      onBack: () => history.back()
    });

    activeReaderTitle = readerApp.querySelector('h1')?.textContent || doc.title.replace(/\s*NGA玩家社区.*$/, '');
    document.title = activeReaderTitle;
    readerApp.focus({ preventScroll: true });
    readerApp.scrollTop = 0;
  }

  function returnFromSPAReader() {
    if (activeSPAController) {
      activeSPAController.abort();
      activeSPAController = null;
    }
    shadow.querySelector('.spa-loading-notice')?.remove();
    if (!readerApp || readerApp.hidden) return;
    readerApp.style.display = 'none';
    readerApp.hidden = true;
    readerApp.replaceChildren();
    activeReaderInstance?.destroy?.();
    activeReaderInstance = null;
    currentReaderURL = null;

    app.style.display = '';
    app.inert = false;
    app.classList.remove('rt-chrome-hidden');
    chromeScroll = savedListScroll;
    document.title = savedListTitle || document.title;
    layoutMasonry();
    setReadingScroll(savedListScroll);
    readingSettings?.setActions([]);
    readingSettings?.visibility(!app.hidden);

    const opener = currentOpener;
    currentOpener = null;
    if (opener?.isConnected && typeof opener.focus === 'function') {
      try { opener.focus({ preventScroll: true }); } catch {}
      setReadingScroll(savedListScroll);
    } else {
      try { app.focus({ preventScroll: true }); } catch {}
    }
    document.dispatchEvent(new (window.CustomEvent || CustomEvent)('readscape-list-resume'));
  }

  function onPopStateSPA(event) {
    if (activeSPAController) {
      activeSPAController.abort();
      activeSPAController = null;
      shadow.querySelector('.spa-loading-notice')?.remove();
    }
    if (readerApp && !readerApp.hidden) {
      if (!event.state?.readscapeSPA) {
        returnFromSPAReader();
        return true;
      }
    }
    return false;
  }

  navigation.setSPAReader?.({ openReader: openReaderSPA, onPopState: onPopStateSPA });
  startList(); configureListRefresh();
  // 列表由 NGA 后续脚本生成时再扫描，不覆盖登录/错误页。
  const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 220); });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  observeListEnd();
  window.addEventListener('pagehide', () => { observer.disconnect(); cardObserver?.disconnect(); listObserver?.disconnect(); listController?.abort(); refreshController?.abort(); stopListRefresh(); clearTimeout(timer); clearTimeout(gateTimer); });
}
