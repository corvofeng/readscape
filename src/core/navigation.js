function createNavigation(config, context = globalThis.window) {
  const window = context;
  const { document, location, history, localStorage, sessionStorage } = window;
  const key = 'reader-toolkit-transition';
  let veil, timeout, background, scrollRestoration;
  const framed = window.top !== window.self;
  // 只允许本脚本创建的同源阅读容器运行适配器。
  function disposeBackground() {
    if (!background) return;
    clearInterval(background.poll); clearTimeout(background.timeout);
    document.title = background.title;
    background.cleanup?.();
    background.frame.remove(); background.notice.remove();
    document.documentElement.removeAttribute('data-readscape-reader-open');
    if (background.list) {
      background.list.style.visibility = background.listVisibility;
      background.list.inert = background.listInert;
      background.list.style.overflow = background.listOverflow;
      if (document.documentElement.hasAttribute('data-readscape-document-scroll')) {
        const left = background.documentScroll.left, top = background.documentMode ? background.documentScroll.top : background.listScroll;
        if (window.scrollX !== left || window.scrollY !== top) window.scrollTo({ left, top });
      } else {
        background.list.scrollTop = background.documentMode ? background.documentScroll.top : background.listScroll;
      }
    }
    if (background.shown && background.focus?.isConnected) background.focus.focus({ preventScroll: true });
    background = null;
    document.dispatchEvent(new document.defaultView.Event('readscape-list-resume'));
  }
  function openReader(u, restoring = false) {
    disposeBackground(); finish();
    const frame = document.createElement('iframe');
    frame.dataset.readscapeReader = 'true'; frame.dataset.readscapeListURL = (restoring && history.state?.readscapeListURL) || location.href; frame.title = '帖子与评论';
    frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;height:100dvh;border:0;z-index:2147483002;visibility:hidden;pointer-events:none;background:#fafafa;overscroll-behavior:none';
    const notice = document.createElement('div');
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'position:fixed;bottom:20px;left:16px;right:16px;width:fit-content;max-width:calc(100% - 32px);z-index:2147483003;padding:12px 16px;border-radius:14px;background:#fff;color:#555;box-shadow:0 4px 24px #0002;font:14px system-ui;display:flex;gap:12px;align-items:center;flex-wrap:wrap';
    const label = document.createElement('span'); label.textContent = '正在后台打开评论…';
    const original = document.createElement('a'); original.href = u.href; original.textContent = '直接打开';
    original.dataset.readscapeNative = 'true';
    const cancel = document.createElement('button'); cancel.textContent = '取消';
    cancel.onclick = () => { if (restoring) history.back(); else disposeBackground(); };
    notice.append(label, original, cancel);
    const state = background = { frame, notice, url: u.href, title: document.title, focus: document.activeElement };
    const fail = () => {
      if (background !== state) return;
      disposeBackground();
      // 后台启动失败也必须完成点击意图，退回浏览器正常导航。
      location.assign(u.href);
    };
    frame.addEventListener('readscape-return', () => history.back());
    frame.addEventListener('error', fail);
    frame.src = u.href;
    document.documentElement.append(frame, notice);
    state.poll = setInterval(() => {
      if (background !== state) return;
      try {
        const doc = frame.contentDocument;
        if (doc?.body && doc.readyState !== 'loading' && doc.URL !== 'about:blank' && state.mountedDoc !== doc) {
          const childURL = new URL(doc.URL);
          if (childURL.origin !== location.origin || !config.accepts(childURL)) { fail(); return; }
          state.cleanup?.(); state.mountedDoc = doc;
          state.cleanup = config.mountReader?.(frame.contentWindow);
        }
        const reader = doc?.getElementById('nga-cards-host')?.shadowRoot?.querySelector('.reader');
        if (!reader || reader.hidden || !reader.querySelector('.comment')) return;
        // 就绪前保留列表、滚动位置和焦点；地址与历史只在成功后更新。
        if (!restoring) history.pushState({ ...history.state, readscapeReader: u.href, readscapeListURL: frame.dataset.readscapeListURL }, '', u.href);
        clearInterval(state.poll); clearTimeout(state.timeout);
        frame.style.visibility = 'visible'; frame.style.pointerEvents = 'auto';
        const list = document.getElementById('nga-cards-host')?.shadowRoot?.querySelector('.app:not(.reader)');
        if (list) {
          Object.assign(state, { list, listVisibility: list.style.visibility, listInert: !!list.inert, listOverflow: list.style.overflow, listScroll: list.scrollTop,
            documentMode: document.documentElement.hasAttribute('data-readscape-document-scroll'), documentScroll: { left: window.scrollX, top: window.scrollY } });
          list.style.visibility = 'hidden'; list.inert = true;
          if (!state.documentMode) list.style.overflow = 'hidden';
          document.documentElement.setAttribute('data-readscape-reader-open', '');
          // 原列表仍在文档中；由它保留位置，避免浏览器遍历历史时另行滚动。
          if (scrollRestoration === undefined) scrollRestoration = history.scrollRestoration ?? 'auto';
          history.scrollRestoration = 'manual';
        }
        state.shown = true; document.title = doc.title;
        notice.remove(); frame.focus({ preventScroll: true });
      } catch { fail(); }
    }, 100);
    state.timeout = setTimeout(fail, 15000);
  }
  function onPopState(event) {
    disposeBackground(); finish();
    const url = event.state?.readscapeReader;
    if (typeof url !== 'string' || !enabled()) return;
    try { const u = new URL(url); if (u.origin === location.origin && config.accepts(u)) openReader(u, true); } catch {}
  }
  if (!framed) window.addEventListener('popstate', onPopState);
  function finish() {
    veil?.remove(); veil = null; clearTimeout(timeout);
    if (!enabled()) {
      disposeBackground();
      if (scrollRestoration !== undefined) { history.scrollRestoration = scrollRestoration; scrollRestoration = undefined; }
    }
    try { sessionStorage.removeItem(key); } catch {}
  }
  function show() {
    if (veil || !document.documentElement) return;
    veil = document.createElement('div');
    veil.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#fff;display:grid;place-items:center;color:#888;font:14px system-ui';
    const box = document.createElement('div'); box.style.textAlign = 'center';
    const label = document.createElement('p'); label.textContent = '正在打开页面…';
    const cancel = document.createElement('button'); cancel.textContent = '显示原页';
    cancel.style.cssText = 'border:0;border-radius:22px;padding:10px 18px;background:#f3f3f5;color:#777;font:inherit';
    cancel.onclick = finish; box.append(label, cancel); veil.append(box);
    document.documentElement.append(veil);
    timeout = setTimeout(finish, 12000);
  }
  function enabled() {
    try { const p = JSON.parse(localStorage.getItem(config.storageKey) || '{}'); return p.enabled !== false && p.smoothNavigation !== false; } catch { return true; }
  }
  try {
    const pending = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (enabled() && pending && Date.now() - pending.at < 20000 && pending.origin === location.origin && config.accepts(new URL(location.href))) show();
    else sessionStorage.removeItem(key);
  } catch {}
  // 列表到评论使用完整同源页面后台加载；其他链接保留原生导航。
  function capture(event) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !enabled()) return;
    const a = event.composedPath().find(n => n?.tagName === 'A');
    if (!a || a.hasAttribute('data-readscape-native') || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
    let u; try { u = new URL(a.href, location.href); } catch { return; }
    if (u.origin !== location.origin || !config.accepts(u) || (u.pathname === location.pathname && u.search === location.search)) return;
    if (framed && /\/thread\.php$/.test(u.pathname)) {
      const listURL = new URL(window.frameElement.dataset.readscapeListURL);
      if (['stid', 'fid'].every(key => u.searchParams.get(key) === listURL.searchParams.get(key))) {
        event.preventDefault();
        window.frameElement.dispatchEvent(new Event('readscape-return'));
        return;
      }
    }
    const list = document.getElementById('nga-cards-host')?.shadowRoot?.querySelector('.app:not(.reader)');
    if (!framed && list && !list.hidden && /\/read\.php$/.test(u.pathname)) {
      event.preventDefault(); openReader(u); return;
    }
    try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), origin: u.origin })); } catch {}
    show();
  }
  document.addEventListener('click', capture);
  window.addEventListener('pageshow', e => { if (e.persisted) finish(); });
  return { finish, show, destroy() { disposeBackground(); finish(); if (scrollRestoration !== undefined) history.scrollRestoration = scrollRestoration; document.removeEventListener('click', capture); window.removeEventListener('popstate', onPopState); } };
}
