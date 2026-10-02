  const firstListPage = Math.max(1, Number(pageURL.searchParams.get('page')) || 1);
  const listPages = new Map();
  let listCursor = firstListPage, listNext = null, listBusy = false, listFailed = false, listController;
  let listBootPending = !!(postCache && window.indexedDB && prefs.enabled !== false);
  let listFromCache = false, pendingListPage, refreshController;
  const pendingListCovers = new Map(), listPointers = new Set();
  let listActivityAt = 0, listUpdateTimer, autoRefreshTimer, pendingAutomatic = false;
  let pullStart, pullDistance = 0, pullCancelled = false;
  const pullIndicator = node('div', 'list-pull', '下拉刷新'); pullIndicator.setAttribute('role', 'status'); app.prepend(pullIndicator);
  function readerCoversList() { return !!document.querySelector('iframe[data-readscape-reader]'); }
  function markListActivity() { listActivityAt = Date.now(); scheduleListUpdate(); }
  function listCanUpdate() {
    return !coverDisposed && !app.hidden && !document.hidden && !readerCoversList() && !listPointers.size && !pullStart && !listBusy && !app.classList.contains('rt-settings-open') && Date.now() - listActivityAt >= 650;
  }
  function queueListCover(card, cached) {
    pendingListCovers.set(card.dataset.tid, cached);
    pendingAutomatic = prefs.autoListRefresh !== false;
    if (pendingAutomatic) scheduleListUpdate();
    else { refreshBar.classList.add('has-update'); refreshButton.hidden = false; refreshStatus.textContent = '封面有更新'; }
  }
  function scheduleListUpdate() {
    clearTimeout(listUpdateTimer);
    if (!pendingAutomatic || !pendingListPage && !pendingListCovers.size || coverDisposed) return;
    listUpdateTimer = setTimeout(() => {
      if (listCanUpdate()) applyListUpdate(false);
      else if (!document.hidden && !readerCoversList() && !app.hidden) scheduleListUpdate();
    }, 700);
  }
  function stopListRefresh() { clearTimeout(autoRefreshTimer); clearTimeout(listUpdateTimer); autoRefreshTimer = listUpdateTimer = null; }
  function configureListRefresh() {
    clearTimeout(autoRefreshTimer);
    if (prefs.autoListRefresh === false) { pendingAutomatic = false; clearTimeout(listUpdateTimer); return; }
    if (coverDisposed || app.classList.contains('reader')) return;
    autoRefreshTimer = setTimeout(async () => {
      if (!document.hidden && !app.hidden && !readerCoversList() && !listBootPending && !listBusy) await revalidateList();
      configureListRefresh();
    }, 10000);
    if (pendingListPage || pendingListCovers.size) { pendingAutomatic = true; scheduleListUpdate(); }
  }
  document.addEventListener('visibilitychange', () => { configureListRefresh(); scheduleListUpdate(); });
  window.addEventListener('pageshow', configureListRefresh);
  document.addEventListener('readscape-list-resume', () => { listPointers.clear(); listActivityAt = Date.now() + 600; scheduleListUpdate(); });
  window.addEventListener('popstate', () => { listActivityAt = Date.now() + 600; scheduleListUpdate(); });
  app.addEventListener('pointerdown', event => { listInteraction = true; listPointers.add(event.pointerId); markListActivity(); }, { passive: true, capture: true });
  const releasePointer = event => { listPointers.delete(event.pointerId); markListActivity(); };
  window.addEventListener('pointerup', releasePointer, { passive: true }); window.addEventListener('pointercancel', releasePointer, { passive: true });
  for (const target of [app, window]) target.addEventListener('scroll', markListActivity, { passive: true });
  function resetPull() { pullStart = null; pullDistance = 0; pullIndicator.classList.remove('is-visible', 'is-ready'); }
  app.addEventListener('touchstart', event => {
    resetPull();
    if (!streamKey || app.classList.contains('reader') || (event.touches?.length || 0) !== 1 || getReadingScroll() > 2 || app.hidden || readerCoversList() || app.classList.contains('rt-settings-open') || event.composedPath().some(el => el?.matches?.('input,button'))) return;
    const point = event.touches[0]; pullStart = { x: point.clientX, y: point.clientY }; pullCancelled = false;
  }, { passive: true });
  app.addEventListener('touchmove', event => {
    if (!pullStart || (event.touches?.length || 0) !== 1 || pullCancelled) { resetPull(); return; }
    markListActivity();
    const point = event.touches[0], delta = point.clientY - pullStart.y;
    if (getReadingScroll() > 2 || Math.abs(point.clientX - pullStart.x) > 40 || delta < -8) { pullCancelled = true; resetPull(); return; }
    pullDistance = Math.min(120, Math.max(0, delta));
    if (pullDistance > 12) { event.preventDefault(); pullIndicator.classList.add('is-visible'); }
    pullIndicator.classList.toggle('is-ready', pullDistance >= 72);
    pullIndicator.textContent = refreshController ? '正在刷新…' : pullDistance >= 72 ? '松开刷新' : '继续下拉刷新';
  }, { passive: false });
  app.addEventListener('touchend', () => {
    const refresh = pullStart && pullDistance >= 72 && !pullCancelled;
    resetPull(); markListActivity();
    if (refresh) revalidateList({ force: true });
  }, { passive: true });
  app.addEventListener('touchcancel', resetPull, { passive: true });
  const refreshBar = node('div', 'list-refresh-bar');
  const refreshStatus = node('span', 'list-refresh-status', '正在准备列表…'); refreshStatus.setAttribute('role', 'status');
  const refreshButton = button('更新列表', 'list-refresh', () => applyListUpdate()); refreshButton.hidden = true;
  refreshBar.append(refreshStatus, refreshButton); main.insertBefore(refreshBar, grid);
  const listLoad = button('加载下一页', 'pill list-load', () => loadNextListPage());
  const listStatus = node('span', 'list-status'); listStatus.setAttribute('role', 'status');

  function listKey(raw) {
    const u = safeURL(raw);
    if (!u || u.origin !== pageURL.origin || u.pathname !== '/thread.php') return null;
    u.searchParams.delete('page'); u.searchParams.delete('rand'); u.searchParams.sort(); u.hash = '';
    return u.href;
  }
  const streamKey = listKey(pageURL.href);
  function validListURL(raw, number) {
    const u = safeURL(raw);
    return u && listKey(u.href) === streamKey && Number(u.searchParams.get('page') || 1) === number ? u.href : null;
  }
  function nextListURL(doc, number, base) {
    for (const a of doc.querySelectorAll('a[href*="thread.php"]')) {
      if (!/^(?:\d+|后页|下一页|>|»)$/.test(a.textContent.trim().replace(/\p{M}/gu, ''))) continue;
      const next = validListURL(safeURL(a.getAttribute('href'), base)?.href, number + 1);
      if (next) return next;
    }
    return null;
  }
  function cacheListPages() {
    if (!streamKey) return;
    const snapshot = new Map(listPages);
    if (pendingListPage) snapshot.set(firstListPage, pendingListPage);
    postCache?.saveListPages(streamKey, snapshot);
  }
  function cachedPages(cache) {
    const restored = new Map();
    let number = firstListPage;
    while (true) {
      const page = cache?.find(p => p.number === number && validListURL(p.url, number));
      if (!page || !page.items.length || !page.items.every(validCachedItem) || page.next && !validListURL(page.next, number + 1)) break;
      restored.set(number, { url: page.url, items: page.items, next: page.next });
      if (!page.next) break;
      number++;
    }
    return restored;
  }
  async function startList() {
    if (!listBootPending) { scan(); return; }
    const generation = postCache.generation;
    app.classList.add('list-preparing'); updateListHeading(); toggle(true); renderPager();
    let cache, cacheTimeout;
    try { cache = await Promise.race([postCache.getListPages(streamKey), new Promise(resolve => { cacheTimeout = setTimeout(() => resolve(null), 1200); })]); } catch {}
    finally { clearTimeout(cacheTimeout); app.classList.remove('list-preparing'); }
    if (coverDisposed) return;
    const restored = generation === postCache.generation ? cachedPages(cache) : new Map();
    listBootPending = false;
    if (!restored.size) { refreshStatus.textContent = '列表已就绪'; scan(); observeListEnd(); return; }
    for (const [number, page] of restored) listPages.set(number, page);
    listCursor = [...restored.keys()].at(-1); listNext = listPages.get(listCursor).next;
    listFromCache = true; mergeListPages(); toggle(prefs.enabled !== false); renderPager(); observeListEnd();
    refreshStatus.textContent = '已显示缓存，正在后台更新…';
    revalidateList();
  }
  function pageSignature(page) {
    return JSON.stringify({ next: page?.next, items: page?.items.map(({tid,title,author,uid,replies,time,url,latest,pinned}) => ({tid,title,author,uid,replies,time,url,latest,pinned})) });
  }
  function stageListPage(page, force = false) {
    if (pageSignature(page) === pageSignature(listPages.get(firstListPage))) {
      pendingListPage = null; refreshBar.classList.remove('has-update'); refreshButton.hidden = true; refreshStatus.textContent = '列表已是最新'; pendingAutomatic = force || prefs.autoListRefresh !== false; scheduleListUpdate(); return;
    }
    pendingListPage = page; refreshBar.classList.add('has-update'); refreshButton.hidden = false;
    refreshStatus.textContent = '有新内容，更新后查看'; refreshButton.textContent = '更新列表';
    pendingAutomatic = force || prefs.autoListRefresh !== false; scheduleListUpdate();
  }
  function applyListUpdate(manual = true) {
    if (readerCoversList() || listPointers.size) { pendingAutomatic = true; scheduleListUpdate(); return; }
    if (!pendingListPage && !pendingListCovers.size) { if (manual) revalidateList({ force: true }); return; }
    const position = getReadingScroll();
    const anchor = [...grid.children].find(card => card.getBoundingClientRect().bottom > top.getBoundingClientRect().bottom);
    const anchorTop = anchor?.getBoundingClientRect().top;
    const before = new Map([...grid.children].map(card => [card.dataset.tid, { card, html: card.innerHTML }]));
    if (pendingListPage) {
      // 自动更新不挪动已有帖子的顺序；离开顶部时新帖子追加到末尾。
      const page = { ...pendingListPage, items: [...pendingListPage.items] }, fresh = new Map(page.items.map(item => [item.tid, item]));
      if (!manual && position > 2) {
        page.items = listPages.get(firstListPage).items.map(item => fresh.get(item.tid) || item);
        const present = new Set(page.items.map(item => item.tid));
        page.items.push(...[...fresh.values()].filter(item => !present.has(item.tid)));
      }
      listPages.set(firstListPage, page); pendingListPage = null;
      listNext = listPages.get(listCursor).next; mergeListPages(); cacheListPages(); render();
    }
    for (const [tid, cached] of pendingListCovers) {
      const card = listCards.get(tid)?.card;
      if (card?.isConnected) setCardCover(card, cached);
    }
    pendingListCovers.clear(); layoutMasonry();
    if (position <= 2) setReadingScroll(0);
    else if (anchor?.isConnected) setReadingScroll(position + anchor.getBoundingClientRect().top - anchorTop);
    for (const card of grid.children) {
      const old = before.get(card.dataset.tid);
      if (old && old.html !== card.innerHTML) {
        card.classList.remove('card-updated'); void card.offsetWidth; card.classList.add('card-updated');
        card.addEventListener('animationend', () => card.classList.remove('card-updated'), { once: true });
      }
    }
    pendingAutomatic = false; refreshBar.classList.remove('has-update'); refreshButton.hidden = true; refreshStatus.textContent = '列表已更新';
  }
  async function fetchListPage(url, number, signal) {
    const response = await fetch(url, { credentials: 'same-origin', signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!validListURL(response.url || url, number)) throw new Error('原站返回了其他页面');
    const bytes = new Uint8Array(await response.arrayBuffer()), initial = new TextDecoder('utf-8').decode(bytes);
    const encoding = response.headers.get('content-type')?.match(/charset\s*=\s*([\w-]+)/i)?.[1] || initial.slice(0,4096).match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || 'utf-8';
    const doc = new DOMParser().parseFromString(new TextDecoder(encoding).decode(bytes), 'text/html');
    const found = extract(doc, url);
    if (!found.length) throw new Error('需要原站跳转、登录，或页面结构不支持');
    return { url, items: found.map(item => ({ ...item, lastAccess: Date.now() })), next: nextListURL(doc, number, url) };
  }
  async function revalidateList({ force = false } = {}) {
    if (!streamKey || app.classList.contains('reader') || refreshController || coverDisposed) return;
    const generation = postCache?.generation;
    const controller = refreshController = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    refreshBar.classList.add('is-loading'); refreshStatus.textContent = '正在后台更新…'; refreshButton.hidden = true;
    try {
      const page = await fetchListPage(pageURL.href, firstListPage, controller.signal);
      if (controller.signal.aborted || coverDisposed || generation !== postCache?.generation) return;
      // 写入新快照，当前已呈现的列表保持不动，等待用户主动更新。
      const snapshot = new Map(listPages); snapshot.set(firstListPage, page); postCache?.saveListPages(streamKey, snapshot);
      listFromCache = true; stageListPage(page, force);
    } catch {
      if (!coverDisposed) { refreshStatus.textContent = '后台更新失败，仍可浏览缓存'; refreshBar.classList.add('has-update'); refreshButton.textContent = pendingListPage ? '更新列表' : '重试更新'; refreshButton.hidden = false; }
    } finally { clearTimeout(timeout); refreshController = null; refreshBar.classList.remove('is-loading'); }
  }
  function validCachedItem(item) {
    if (!item || typeof item.tid !== 'string' || !/^\d+$/.test(item.tid) || typeof item.title !== 'string' || typeof item.author !== 'string' || typeof item.time !== 'string') return false;
    const u = safeURL(item.url), latest = item.latest && safeURL(item.latest);
    return u?.origin === pageURL.origin && u.pathname === '/read.php' && u.searchParams.get('tid') === item.tid &&
      (!item.latest || latest?.origin === pageURL.origin && latest.pathname === '/read.php' && latest.searchParams.get('tid') === item.tid);
  }
  function mergeListPages() {
    const seen = new Set(); items = [];
    for (const page of listPages.values()) for (const item of page.items) {
      if (seen.has(item.tid)) continue;
      seen.add(item.tid); items.push(item);
    }
  }
  function updateListPage(found) {
    for (const item of found) item.lastAccess = Date.now();
    const page = { url: pageURL.href, items: found, next: nextListURL(document, firstListPage, pageURL.href) };
    if (listFromCache) return;
    if (listInteraction) { stageListPage(page); return; }
    listPages.set(firstListPage, page);
    listNext = listPages.get(listCursor).next;
    mergeListPages(); cacheListPages();
  }
  function updateListControls() {
    grid.setAttribute('aria-busy', String(listBusy || listBootPending));
    listLoad.disabled = listBusy || listBootPending;
    listLoad.hidden = !listNext;
    listLoad.textContent = listBusy ? '正在加载…' : listFailed ? '重试下一页' : '加载下一页';
    if (!listNext && items.length) listStatus.textContent = '已经到底了';
  }
  async function loadNextListPage() {
    if (listBusy || listBootPending || !listNext || app.hidden) return;
    const url = listNext, number = listCursor + 1;
    listBusy = true; listFailed = false; updateListControls(); listStatus.textContent = `正在读取第 ${number} 页…`;
    const controller = listController = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const page = await fetchListPage(url, number, controller.signal), found = page.items;
      if (controller.signal.aborted) return;
      if (!found.some(item => !items.some(existing => existing.tid === item.tid))) {
        listNext = null; listStatus.textContent = '原站未返回新帖子，已停止重复加载。'; return;
      }
      listNext = page.next;
      listPages.set(number, { url, items: found, next: listNext }); listCursor = number;
      mergeListPages(); cacheListPages(); render();
      listStatus.textContent = listNext ? `已加载第 ${number} 页` : '已经到底了';
    } catch (error) {
      listFailed = true;
      listStatus.replaceChildren(node('span', '', `${error.name === 'AbortError' ? '加载超时' : error.message}。 `), link(url, '在原站打开'));
      listStatus.querySelector('a').dataset.readscapeNative = 'true';
    } finally { clearTimeout(timeout); listBusy = false; updateListControls(); observeListEnd(); }
  }
  function observeListEnd() {
    listObserver?.disconnect();
    if (typeof window.IntersectionObserver !== 'function' || !streamKey) return;
    listObserver = new window.IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && !listFailed && tab === 'all' && !query && !document.documentElement.hasAttribute('data-readscape-reader-open')) loadNextListPage();
    }, { root: usesDocumentScroll() ? null : app, rootMargin: '0px 0px 600px 0px' });
    listObserver.observe(pager);
  }
