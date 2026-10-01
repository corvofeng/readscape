function createNavigation(config) {
  const key = 'reader-toolkit-transition';
  let veil, timeout;
  function finish() {
    veil?.remove(); veil = null; clearTimeout(timeout);
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
  // 原生导航：不拦截请求，不执行抓取页面中的脚本，保留浏览器返回行为。
  function capture(event) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !enabled()) return;
    const a = event.composedPath().find(n => n?.tagName === 'A');
    if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
    let u; try { u = new URL(a.href, location.href); } catch { return; }
    if (u.origin !== location.origin || !config.accepts(u) || (u.pathname === location.pathname && u.search === location.search)) return;
    try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), origin: u.origin })); } catch {}
    show();
  }
  document.addEventListener('click', capture);
  window.addEventListener('pageshow', e => { if (e.persisted) finish(); });
  return { finish, show, destroy() { finish(); document.removeEventListener('click', capture); } };
}
