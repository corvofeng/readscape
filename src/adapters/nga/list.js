  const firstListPage = Math.max(1, Number(pageURL.searchParams.get('page')) || 1);
  const listPages = new Map();
  let listCursor = firstListPage, listNext = null, listBusy = false, listFailed = false, listHydrated = false, listController;
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
    if (streamKey) postCache?.saveListPages(streamKey, listPages);
  }
  async function hydrateListPages() {
    if (listHydrated || !postCache) return;
    listHydrated = true;
    const generation = postCache.generation;
    const cache = await postCache.getListPages(streamKey);
    if (!cache || generation !== postCache.generation || coverDisposed || listBusy || listCursor !== firstListPage || listPages.size !== 1) return;
    let next = listPages.get(firstListPage)?.next;
    while (next) {
      const number = listCursor + 1;
      const page = cache.find(p => p.number === number && validListURL(p.url, number));
      if (!page || !page.items.length || !page.items.every(validCachedItem) || page.next && !validListURL(page.next, number + 1)) break;
      listPages.set(number, { url:page.url, items:page.items, next:page.next }); listCursor = number; next = page.next;
    }
    if (listPages.size > 1) { listNext = listPages.get(listCursor).next; mergeListPages(); render(); }
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
    listPages.set(firstListPage, { url: pageURL.href, items: found, next: nextListURL(document, firstListPage, pageURL.href) });
    listNext = listPages.get(listCursor).next;
    mergeListPages(); cacheListPages(); hydrateListPages();
  }
  function updateListControls() {
    listLoad.disabled = listBusy;
    listLoad.hidden = !listNext;
    listLoad.textContent = listBusy ? '正在加载…' : listFailed ? '重试下一页' : '加载下一页';
    if (!listNext && items.length) listStatus.textContent = '已经到底了';
  }
  async function loadNextListPage() {
    if (listBusy || !listNext || app.hidden) return;
    const url = listNext, number = listCursor + 1;
    listBusy = true; listFailed = false; updateListControls(); listStatus.textContent = `正在读取第 ${number} 页…`;
    const controller = listController = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!validListURL(response.url || url, number)) throw new Error('原站返回了其他页面');
      const bytes = new Uint8Array(await response.arrayBuffer()), initial = new TextDecoder('utf-8').decode(bytes);
      const encoding = response.headers.get('content-type')?.match(/charset\s*=\s*([\w-]+)/i)?.[1] || initial.slice(0,4096).match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || 'utf-8';
      const doc = new DOMParser().parseFromString(new TextDecoder(encoding).decode(bytes), 'text/html');
      const found = extract(doc, url);
      for (const item of found) item.lastAccess = Date.now();
      if (!found.length) throw new Error('需要原站跳转、登录，或页面结构不支持');
      if (controller.signal.aborted) return;
      if (!found.some(item => !items.some(existing => existing.tid === item.tid))) {
        listNext = null; listStatus.textContent = '原站未返回新帖子，已停止重复加载。'; return;
      }
      listNext = nextListURL(doc, number, url);
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
