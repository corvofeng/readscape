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
  function applyListCovers() {
    if (!pendingListCovers.size || coverDisposed) return;
    const position = getReadingScroll();
    const anchor = [...grid.children].find(card => card.getBoundingClientRect().bottom > top.getBoundingClientRect().bottom);
    const anchorTop = anchor?.getBoundingClientRect().top;
    const before = new Map([...grid.children].map(card => [card.dataset.tid, { card, html: card.innerHTML }]));
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
    if (!pendingListPage) {
      refreshBar.classList.remove('has-update');
      refreshButton.hidden = true;
    }
  }
  function queueListCover(card, cached) {
    pendingListCovers.set(card.dataset.tid, cached);
    if (!readerCoversList() && !listInteraction) {
      applyListCovers();
    } else if (prefs.autoListRefresh !== false) {
      pendingAutomatic = true;
      scheduleListUpdate();
    }
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
  window.addEventListener('pageshow', () => { applyListCovers(); configureListRefresh(); });
  document.addEventListener('readscape-list-resume', () => { listPointers.clear(); applyListCovers(); listActivityAt = Date.now() + 600; scheduleListUpdate(); });
  function showNotice(message, title = '提示') {
    let dialog = app.querySelector('.notice-dialog');
    if (!dialog) {
      dialog = node('dialog', 'notice-dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', title);
      const head = node('div', 'notice-dialog-title', title);
      const msg = node('div', 'notice-dialog-msg');
      const actions = node('div', 'notice-dialog-actions');
      const ok = button('确定', 'notice-dialog-btn', () => close());
      actions.append(ok);
      dialog.append(head, msg, actions);
      dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
      dialog.addEventListener('cancel', () => close());
      app.append(dialog);
    }
    const msg = dialog.querySelector('.notice-dialog-msg');
    if (msg) msg.textContent = message;
    const titleEl = dialog.querySelector('.notice-dialog-title');
    if (titleEl) titleEl.textContent = title;
    dialog.setAttribute('aria-label', title);
    const returnFocus = shadow.activeElement || document.activeElement;
    function close() {
      if (dialog.open) {
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      }
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      else grid.focus?.({ preventScroll: true });
    }
    if (typeof dialog.showModal === 'function') {
      try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); }
    } else if (typeof dialog.show === 'function') {
      dialog.show();
    } else {
      dialog.setAttribute('open', '');
    }
    dialog.querySelector('.notice-dialog-btn')?.focus({ preventScroll: true });
    return { dialog, close };
  }
  function removeDeletedCard(tid) {
    const entry = listCards.get(tid);
    const card = entry?.card || grid.querySelector(`[data-tid="${tid}"]`);
    if (card) {
      cardObserver?.unobserve(card);
      card.remove();
      listCards.delete(tid);
    }
    items = items.filter(item => item.tid !== tid);
    for (const page of listPages.values()) {
      if (Array.isArray(page?.items)) {
        page.items = page.items.filter(item => item.tid !== tid);
      }
    }
    if (favorites[tid]) {
      delete favorites[tid];
      favoriteChanges.add(tid);
      postCache?.setFavorite({ tid }, false);
    }
    cacheListPages();
    postCache?.remove([tid]);
    layoutMasonry();
    const source = tab === 'saved' ? Object.values(favorites) : items;
    const visibleCount = source.filter(item => (tab !== 'hot' || item.replies >= 100) && (!query || `${item.title} ${item.author}`.toLowerCase().includes(query))).length;
    subtitle.textContent = `第 ${firstListPage}${listPages.size > 1 ? `–${listCursor}` : ''} 页 · ${visibleCount} 篇${query ? ' · 已加载搜索' : ''}`;
    empty.hidden = visibleCount > 0;
    updateListControls();
  }
  const handlePostDeleted = event => {
    const { tid } = event.detail || {};
    if (!tid) return;
    const entry = listCards.get(tid);
    const title = entry?.card?.item?.title || entry?.card?.querySelector?.('.title')?.textContent || '';
    removeDeletedCard(tid);
    showNotice(title ? `“${title}” 帖子已被删除，已从瀑布流中移除。` : '该帖子已被删除，已从瀑布流中移除。');
  };
  document.addEventListener('readscape-post-deleted', handlePostDeleted);
  window.addEventListener('pagehide', () => document.removeEventListener('readscape-post-deleted', handlePostDeleted));
  window.addEventListener('popstate', () => { applyListCovers(); listActivityAt = Date.now() + 600; scheduleListUpdate(); });
  app.addEventListener('pointerdown', event => { listInteraction = true; listPointers.add(event.pointerId); markListActivity(); }, { passive: true, capture: true });
  const releasePointer = event => { listPointers.delete(event.pointerId); markListActivity(); };
  window.addEventListener('pointerup', releasePointer, { passive: true }); window.addEventListener('pointercancel', releasePointer, { passive: true });
  for (const target of [app, window]) target.addEventListener('scroll', markListActivity, { passive: true });
  function resetPull() { pullStart = null; pullDistance = 0; pullIndicator.classList.remove('is-visible', 'is-ready'); }
  app.addEventListener('touchstart', event => {
    resetPull();
    if (!streamKey || app.classList.contains('reader') || document.documentElement.hasAttribute('data-readscape-modal-open') || (event.touches?.length || 0) !== 1 || getReadingScroll() > 2 || app.hidden || readerCoversList() || app.classList.contains('rt-settings-open') || app.classList.contains('boards-open') || event.composedPath().some(el => el?.closest?.('.board-dialog, .notice-dialog, .rt-mask, .subforum-strip, .tabs') || el?.matches?.('input,button,a'))) return;
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
    const nextURL = new URL(base); nextURL.searchParams.set('page', number + 1); nextURL.hash = '';
    // 原站分页栏可能尚未生成，抓取的 HTML 也不会执行生成分页的脚本。
    let metadata = doc === document ? ngaPageContext(window).__PAGE : null;
    if (!metadata) {
      const literal = [...doc.scripts].map(script => script.textContent).join('\n').match(/\b__PAGE\s*=\s*\{([^}]+)\}/)?.[1];
      if (literal) {
        metadata = {};
        for (const match of literal.matchAll(/(?:^|,)\s*['"]?([123])['"]?\s*:\s*(\d+)/g)) metadata[match[1]] = Number(match[2]);
      }
    }
    if (Number.isSafeInteger(Number(metadata?.[1])) && Number(metadata[1]) >= 0 && Number(metadata[3]) > 0) {
      return number < Math.ceil((Number(metadata[1]) + 1) / Number(metadata[3])) ? nextURL.href : null;
    }
    for (const a of doc.querySelectorAll('a[href]')) {
      const next = validListURL(safeURL(a.getAttribute('href'), base)?.href, number + 1);
      if (next) return next;
    }
    // 缺少分页信息不代表末页；按原站 page 参数尝试，重复页和错误响应会停止加载。
    return nextURL.href;
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
      const next = page.next || nextListURL(document, number, page.url);
      restored.set(number, { url: page.url, items: page.items, next });
      if (!page.next) break;
      number++;
    }
    return restored;
  }
  async function startList() {
    if (typeof isForumRoot !== 'undefined' && isForumRoot) { listBootPending = false; scan(); return; }
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
    // 相对时间、分页和排序变化不代表帖子有新内容；兼容旧缓存缺省字段。
    return JSON.stringify(page?.items.map(({tid,title,author,uid,replies,url,latest,pinned}) => ({
      tid, title, author, uid: uid || null, replies: replies ?? null, url,
      latest: latest || url, pinned: !!pinned
    })).sort((a, b) => a.tid.localeCompare(b.tid)));
  }
  function stageListPage(page, force = false) {
    if (pageSignature(page) === pageSignature(listPages.get(firstListPage))) {
      listPages.get(firstListPage).next = page.next;
      listNext = listPages.get(listCursor).next; updateListControls();
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
    applyListCovers();
    pendingAutomatic = false;
    if (!pendingListPage) {
      refreshBar.classList.remove('has-update');
      refreshButton.hidden = true;
      refreshStatus.textContent = '列表已更新';
    }
  }
  async function fetchListPage(url, number, signal) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-cache', signal });
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
    if (listPages.has(firstListPage) && listCursor === firstListPage && listNext !== page.next) {
      listPages.get(firstListPage).next = listNext = page.next;
      cacheListPages();
    }
    if (listFromCache) return;
    if (listInteraction) { revalidateList(); return; }
    listPages.set(firstListPage, page);
    listNext = listPages.get(listCursor).next;
    mergeListPages(); cacheListPages();
  }
  function updateListControls() {
    grid.setAttribute('aria-busy', String(listBusy || listBootPending));
    listLoad.disabled = listBusy || listBootPending;
    listLoad.hidden = !listNext;
    listLoad.textContent = listBusy ? '正在加载…' : listFailed ? '重试下一页' : '加载下一页';
    if (listNext && listStatus.textContent === '已经到底了') listStatus.textContent = '';
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
