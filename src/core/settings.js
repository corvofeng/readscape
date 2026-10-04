function mountSettings({ context = globalThis.window, shadow, app, prefs, save, change, original, login, cache, openBoards }) {
  const document = context.document;
  const style = document.createElement('style');
  style.textContent = `
    .rt-mask[hidden],.rt-fab[hidden]{display:none!important}
    .rt-fab,.rt-mask{--rt-surface:#fff8fa;--rt-text:#30272d;--rt-muted:#776b73;--rt-accent:#a43d60;--rt-container:#f5dce5;--rt-outline:#d8c4cc}
    [data-rt-theme=dark]{--rt-surface:#202329;--rt-text:#f3e4ed;--rt-muted:#cbb9c4;--rt-accent:#ff8ba0;--rt-container:#35252e;--rt-outline:#34373e;color-scheme:dark}
    [data-rt-theme=paper]{--rt-surface:#faf5eb;--rt-text:#3c332d;--rt-muted:#7b6f61;--rt-container:#eee2cf;--rt-outline:#d3c5b2}
    .rt-fab{position:fixed;right:16px;bottom:calc(24px + env(safe-area-inset-bottom));z-index:2147483010;width:56px;height:56px;display:grid;place-items:center;border:0;border-radius:18px;background:var(--rt-container);color:var(--rt-accent);box-shadow:0 3px 8px #38212e26,0 1px 3px #38212e1a;touch-action:manipulation;transition:box-shadow .18s,transform .18s}
    .rt-fab:active{transform:scale(.94);box-shadow:0 1px 3px #38212e33}.rt-fab svg{width:24px;height:24px;pointer-events:none}
    .rt-mask{position:fixed;inset:0;z-index:2147483015;width:100vw;height:100dvh;max-width:100vw;max-height:100dvh;margin:0;padding:0;border:0;background:rgba(0,0,0,.45);backdrop-filter:blur(4px);pointer-events:auto;display:flex;align-items:center;justify-content:center;color:var(--rt-text);overscroll-behavior:contain;touch-action:pan-y;box-sizing:border-box}
    .rt-mask:not([open]){display:none!important}
    .rt-mask::backdrop{background:transparent}
    .rt-sheet{background:var(--rt-surface);color:var(--rt-text);pointer-events:auto;width:min(500px,calc(100vw - 32px));max-height:86dvh;display:flex;flex-direction:column;overflow:hidden;overscroll-behavior:contain;border-radius:24px;border:1px solid var(--rt-outline);box-shadow:0 14px 50px rgba(0,0,0,.25);font:14px/1.5 system-ui;touch-action:pan-y;position:relative}
    .rt-handle{display:none;width:100%;height:20px;align-items:center;justify-content:center;cursor:grab;flex:none;touch-action:none}
    .rt-handle:before{content:'';width:40px;height:5px;border-radius:3px;background:var(--rt-muted);opacity:.45}
    .rt-header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px 12px;border-bottom:1px solid color-mix(in srgb,var(--rt-outline) 35%,transparent);flex:none;gap:12px}
    .rt-header h2{font-size:17px;font-weight:700;margin:0;display:flex;align-items:center;gap:8px;white-space:nowrap}
    .rt-header .rt-account{font-size:12px;padding:6px 12px;border-radius:16px;background:var(--rt-container);color:var(--rt-accent);min-width:0;max-width:150px;text-align:left;border:0;cursor:pointer}
    .rt-close{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-size:22px;line-height:1;color:var(--rt-muted);background:transparent;border:0;cursor:pointer;transition:background .15s,color .15s}
    .rt-close:hover{background:var(--rt-container);color:var(--rt-accent)}
    .rt-body{flex:1;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:16px 20px calc(16px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:12px;touch-action:pan-y}
    .rt-boards-btn{display:flex;align-items:center;justify-content:space-between;padding:11px 16px;border-radius:16px;background:var(--rt-container);color:var(--rt-accent);font-size:14px;font-weight:700;border:0;cursor:pointer;transition:filter .15s}
    .rt-boards-btn:active{filter:brightness(.92)}
    .rt-sheet label{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:46px;border-bottom:1px solid color-mix(in srgb,var(--rt-outline) 35%,transparent);cursor:pointer}
    .rt-sheet select{max-width:180px;min-height:36px;padding:6px 10px;border:1px solid var(--rt-outline);border-radius:12px;background:transparent;color:var(--rt-text);font:inherit}
    .rt-range{display:flex;align-items:center;gap:10px}.rt-scale{min-width:40px;text-align:right;font-size:13px;color:var(--rt-muted);font-variant-numeric:tabular-nums}.rt-sheet input[type=range]{width:110px;height:36px;accent-color:var(--rt-accent);cursor:pointer}
    .rt-sheet input[type=checkbox]{appearance:none;-webkit-appearance:none;flex:none;width:52px;height:32px;border:2px solid var(--rt-outline);border-radius:20px;background:var(--rt-outline);position:relative;cursor:pointer;transition:background .18s,border-color .18s}.rt-sheet input[type=checkbox]:before{content:'';position:absolute;left:4px;top:4px;width:20px;height:20px;border-radius:50%;background:var(--rt-muted);transition:transform .18s,background .18s}.rt-sheet input[type=checkbox]:checked{background:var(--rt-accent);border-color:var(--rt-accent)}.rt-sheet input[type=checkbox]:checked:before{transform:translateX(20px);background:var(--rt-surface)}
    .rt-sheet button{touch-action:manipulation}
    .rt-actions{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}.rt-actions button{flex:1;min-height:42px;padding:8px 16px;border-radius:20px;background:var(--rt-container);color:var(--rt-accent);font-weight:600;border:0;cursor:pointer;white-space:nowrap;transition:filter .15s}.rt-actions button:active{filter:brightness(.92)}
    .rt-more{background:color-mix(in srgb,var(--rt-surface) 60%,var(--rt-container) 40%);border:1px solid color-mix(in srgb,var(--rt-outline) 40%,transparent);border-radius:18px;padding:4px 16px 12px;margin-top:4px}
    .rt-more>summary{cursor:pointer;color:var(--rt-accent);font-weight:600;padding:10px 0}
    .account-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.account-uid{display:block;font-size:10px;font-weight:400;white-space:nowrap;opacity:.75}.rt-note{font-size:12px;color:var(--rt-muted);margin:10px 0 0}
    .rt-cache{background:color-mix(in srgb,var(--rt-surface) 60%,var(--rt-container) 40%);border:1px solid color-mix(in srgb,var(--rt-outline) 40%,transparent);border-radius:18px;padding:12px 16px;margin-top:4px}
    .rt-cache-usage{font-size:12px;line-height:1.6;color:var(--rt-muted);margin:4px 0 8px;overflow-wrap:anywhere}.rt-cache summary{padding:8px 0;cursor:pointer;color:var(--rt-accent);font-weight:600}.rt-cache input[type=number]{width:84px;min-height:36px;background:var(--rt-container);color:var(--rt-text);border:0;border-radius:8px;padding:6px}
    .rt-clear-cache{padding:7px 14px;border-radius:16px;background:var(--rt-container);color:var(--rt-accent);border:0;font-weight:600;cursor:pointer}
    .rt-reader-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:0 0 8px}.rt-reader-actions[hidden]{display:none}.rt-reader-actions{grid-template-columns:repeat(3,minmax(0,1fr))}.rt-reader-actions button,.rt-reader-actions a{display:flex;align-items:center;justify-content:center;min-height:44px;border-radius:24px;background:var(--rt-container);color:var(--rt-accent);font-weight:600;padding:8px 4px;font-size:13px}.rt-reader-actions .reply-entry{background:var(--rt-accent);color:var(--rt-surface)}
    @keyframes rt-sheet-enter{from{transform:translateY(48px);opacity:0}to{transform:translateY(0);opacity:1}}
    @media(prefers-reduced-motion:reduce){.rt-sheet{animation:none}.rt-fab,.rt-sheet button,.rt-sheet input[type=checkbox],.rt-sheet input[type=checkbox]:before{transition:none}}
    .app{font-family:var(--rt-font,system-ui);max-width:100vw;overflow-x:hidden;text-size-adjust:100%;-webkit-text-size-adjust:100%}.app main,.grid,.bar{min-width:0;width:100%}.grid>.card{min-width:0;max-width:100%}
    .app.rt-settings-open{padding-bottom:calc(30px + var(--rt-panel-height,260px) + env(safe-area-inset-bottom))}.app .comment-content{font-size:calc(15px * var(--rt-scale,1))}.app .comment.op .comment-content{font-size:calc(16px * var(--rt-scale,1))}.app .thread .comment-content{font-size:calc(14px * var(--rt-scale,1))}.app .mobile-caption,.app .image-title{font-size:calc(14px * var(--rt-scale,1))}.app .cover .title{font-size:calc(18px * var(--rt-scale,1))}
    .app.rt-paper{background:#f6f2e9}.app.rt-paper .top,.app.rt-paper .card,.app.rt-paper .comment.op{background:#faf7ef}.app.rt-dark{background:#17191d;color:#e0e0e5;color-scheme:dark}.app.rt-dark .top,.app.rt-dark .card,.app.rt-dark .comment{background:#202329;border-color:#34373e}.app.rt-dark .comment-content,.app.rt-dark .tabs button[aria-selected=true],.app.rt-dark .tabs button[aria-pressed=true]{color:#eee}.app.rt-dark .quoted,.app.rt-dark .search input,.app.rt-dark .load-next{background:#2c3038;color:#bbb}.app.rt-dark .cover:not(.has-image){background:#30343d}.app.rt-dark .cover .title,.app.rt-dark .eyebrow{color:#ddd}.app.rt-dark .tag{background:#444;color:#ddd}
    @media(max-width:600px){
      .rt-mask{align-items:flex-end;padding:0}
      .rt-sheet{width:100vw;max-width:100vw;max-height:86dvh;border-radius:20px 20px 0 0;border:0;box-shadow:0 -8px 36px rgba(0,0,0,.25)}
      .rt-handle{display:flex}
      .rt-header{padding:6px 16px 8px}
      .rt-body{padding:12px 16px calc(14px + env(safe-area-inset-bottom))}
    }
    @media(min-width:601px){.rt-mask{align-items:center;justify-content:center;padding:20px}.rt-sheet{border-radius:24px}.rt-fab{bottom:24px}.app .cover .title{font-size:calc(20px * var(--rt-scale,1))}.app .image-title{font-size:calc(16px * var(--rt-scale,1))}}
  `;
  shadow.append(style);
  const fab = document.createElement('button'); fab.type = 'button'; fab.className = 'rt-fab'; fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>'; fab.setAttribute('aria-haspopup', 'dialog'); fab.setAttribute('aria-controls', 'readscape-settings'); fab.setAttribute('aria-label', '阅读设置'); fab.setAttribute('aria-expanded', 'false');
  const mask = document.createElement('dialog'); mask.id = 'readscape-settings'; mask.setAttribute('aria-label', '阅读设置'); mask.className = 'rt-mask'; mask.hidden = true;
  const sheet = document.createElement('section'); sheet.className = 'rt-sheet'; sheet.tabIndex = -1;
  const header = document.createElement('div'); header.className = 'rt-header';
  const title = document.createElement('h2'); title.innerHTML = '<span>⚙️</span> 阅读设置';
  const close = document.createElement('button'); close.className = 'rt-close'; close.textContent = '×'; close.setAttribute('aria-label', '关闭设置'); header.append(title, close);
  const handle = document.createElement('div'); handle.className = 'rt-handle'; handle.setAttribute('aria-hidden', 'true');
  const body = document.createElement('div'); body.className = 'rt-body';
  sheet.append(handle, header, body);
  let dragStart;
  handle.addEventListener('pointerdown', event => { dragStart = event.clientY; handle.setPointerCapture?.(event.pointerId); });
  handle.addEventListener('pointerup', event => { if (dragStart != null && event.clientY - dragStart > 60) hide(); dragStart = null; });
  handle.addEventListener('pointercancel', () => { dragStart = null; });
  handle.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    dragStart = e.touches[0].clientY;
  }, { passive: true });
  handle.addEventListener('touchmove', e => {
    if (dragStart == null) return;
    const deltaY = e.touches[0].clientY - dragStart;
    if (deltaY > 0) {
      if (e.cancelable) e.preventDefault();
      sheet.style.transform = `translateY(${deltaY}px)`;
    }
  }, { passive: false });
  handle.addEventListener('touchend', () => {
    if (dragStart == null) return;
    const currentY = Number(sheet.style.transform.match(/translateY\(([\d.]+)px\)/)?.[1] || 0);
    if (currentY > 80) {
      sheet.style.transform = 'translateY(100%)';
      setTimeout(() => { hide(); sheet.style.transform = ''; }, 160);
    } else {
      sheet.style.transform = '';
    }
    dragStart = null;
  }, { passive: true });
  const controls = new Map();
  const readerActions = document.createElement('div'); readerActions.className = 'rt-reader-actions'; readerActions.hidden = true; body.append(readerActions);
  if (openBoards) {
    const boardsBtn = document.createElement('button');
    boardsBtn.type = 'button';
    boardsBtn.className = 'rt-boards-btn';
    boardsBtn.innerHTML = '<span>🧭 切换论坛板块</span> ➔';
    boardsBtn.onclick = () => { hide(true, true); openBoards(); };
    body.append(boardsBtn);
  }
  const THEME_COLORS = { light: '#ffffff', paper: '#faf7ef', dark: '#17191d' };
  const originalThemeColor = document.querySelector('meta[name="theme-color"]');
  const originalThemeColorContent = originalThemeColor?.getAttribute('content');
  const themeColorMeta = originalThemeColor || document.createElement('meta');
  themeColorMeta.name = 'theme-color';
  function syncThemeMetadata(active = !fab.hidden) {
    const theme = prefs.theme || 'light';
    const color = THEME_COLORS[theme] || THEME_COLORS.light;
    const docs = [document];
    try {
      if (context.parent && context.parent !== context && context.parent.document) {
        docs.push(context.parent.document);
      }
    } catch {}
    for (const doc of docs) {
      if (active) {
        doc.documentElement.dataset.rtTheme = theme;
        let meta = doc.querySelector('meta[name="theme-color"]');
        if (!meta) {
          meta = doc.createElement('meta');
          meta.name = 'theme-color';
          doc.head?.append(meta);
        }
        meta.setAttribute('content', color);
      } else {
        doc.documentElement.removeAttribute('data-rt-theme');
        const meta = doc.querySelector('meta[name="theme-color"]');
        if (meta) {
          if (doc === document && originalThemeColor) {
            if (originalThemeColorContent == null) meta.removeAttribute('content');
            else meta.setAttribute('content', originalThemeColorContent);
          } else if (doc === document && !originalThemeColor) {
            meta.remove();
          }
        }
      }
    }
  }
  function apply() {
    const scale = Math.min(1.4, Math.max(.85, Number(prefs.fontScale) || 1));
    app.style.setProperty('--rt-scale', scale);
    app.style.setProperty('--rt-font', prefs.font === 'serif' ? '"Songti SC","Noto Serif CJK SC",serif' : prefs.font === 'rounded' ? 'ui-rounded,"Arial Rounded MT Bold","PingFang SC",sans-serif' : '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif');
    const theme = prefs.theme || 'light';
    mask.dataset.rtTheme = fab.dataset.rtTheme = theme;
    app.classList.toggle('rt-paper', theme === 'paper'); app.classList.toggle('rt-dark', theme === 'dark');
    syncThemeMetadata(!fab.hidden);
  }
  function row(label, key, type, options, target = body) {
    const wrap = document.createElement('label'); const text = document.createElement('span'); text.textContent = label;
    const c = document.createElement(type === 'select' ? 'select' : 'input'); c.setAttribute('aria-label', label); c.dataset.pref = key;
    if (type === 'select') for (const [value, name] of options) { const opt = document.createElement('option'); opt.value = value; opt.textContent = name; c.append(opt); }
    else { c.type = type; if (type === 'checkbox') c.setAttribute('role', 'switch'); if (type === 'range') { c.min = '.85'; c.max = '1.4'; c.step = '.05'; } }
    const update = () => { prefs[key] = type === 'checkbox' ? c.checked : type === 'range' || type === 'number' ? Number(c.value) : c.value; if (key === 'cacheMaxPosts') prefs[key] = Math.max(1, Math.min(500, Math.trunc(prefs[key]) || 0)); save(); sync(); apply(); configureCache(); change(); };
    c.addEventListener(type === 'range' ? 'input' : 'change', update); controls.set(key, c); wrap.append(text);
    if (type === 'range') { const group = document.createElement('span'); group.className = 'rt-range'; const value = document.createElement('output'); value.className = 'rt-scale'; value.setAttribute('aria-label', '当前字号'); group.append(c, value); wrap.append(group); } else wrap.append(c);
    target.append(wrap);
  }
  row('字号', 'fontScale', 'range'); row('字体', 'font', 'select', [['system','系统字体'],['serif','宋体 / 衬线'],['rounded','圆润字体']]);
  const more = document.createElement('details'); more.className = 'rt-more';
  const moreTitle = document.createElement('summary'); moreTitle.textContent = '更多设置'; more.append(moreTitle); body.append(more);
  row('配色', 'theme', 'select', [['light','明亮'],['paper','暖纸'],['dark','深色']], more);
  row('手机单列', 'single', 'checkbox', undefined, more); row('关联对话', 'groupReplies', 'checkbox', undefined, more); row('平滑跳转过渡', 'smoothNavigation', 'checkbox', undefined, more); row('列表自动刷新（10 秒）', 'autoListRefresh', 'checkbox', undefined, more);
  const note = document.createElement('p'); note.className = 'rt-note'; note.textContent = '字体使用设备现有字体。单双列适用于列表；关联对话适用于评论，关闭时按楼层顺序阅读。'; more.append(note);
  const actions = document.createElement('div'); actions.className = 'rt-actions';
  const reset = document.createElement('button'); reset.textContent = '恢复默认';
  const native = document.createElement('button'); native.textContent = '查看原版'; actions.append(reset, native); more.append(actions);
  const cacheSection = document.createElement('section'); cacheSection.className = 'rt-cache'; cacheSection.hidden = !cache;
  const cacheUsage = document.createElement('p'); cacheUsage.className = 'rt-cache-usage'; cacheUsage.setAttribute('role', 'status'); cacheUsage.textContent = '正在统计缓存…';
  const cacheOptions = document.createElement('details'); const cacheTitle = document.createElement('summary'); cacheTitle.textContent = '缓存设置'; cacheOptions.append(cacheTitle);
  row('本地缓存', 'cacheEnabled', 'checkbox', undefined, cacheOptions); row('帖子上限', 'cacheMaxPosts', 'number', undefined, cacheOptions);
  { const input = controls.get('cacheMaxPosts'); input.min = '1'; input.max = '500'; input.step = '1'; }
  const clearCache = document.createElement('button'); clearCache.type = 'button'; clearCache.className = 'rt-clear-cache'; clearCache.textContent = '清理缓存';
  const cacheNote = document.createElement('p'); cacheNote.className = 'rt-note'; cacheNote.textContent = '30 天未访问自动清理。手动清理保留收藏书签和阅读设置。';
  cacheSection.append(cacheUsage, clearCache, cacheOptions, cacheNote); body.append(cacheSection);
  let cacheVersion = 0, clearingCache = false;
  const formatBytes = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
  async function refreshCache() {
    if (!cache || clearingCache) return;
    const version = ++cacheVersion, used = await cache.stats();
    if (version !== cacheVersion || clearingCache) return;
    if (!used.available) { cacheUsage.textContent = '本地缓存不可用，仍可正常阅读。'; clearCache.disabled = true; return; }
    clearCache.disabled = false;
    cacheUsage.textContent = `缓存估算 ${formatBytes(used.totalBytes)} · 帖子 ${used.posts}/${used.maxPosts} · 回复 ${used.replyPages} 页${used.enabled ? '' : ' · 缓存已关闭'}`;
  }
  function configureCache() { cache?.configure({enabled:prefs.cacheEnabled !== false,maxPosts:prefs.cacheMaxPosts ?? 500,maxMetadataBytes:prefs.cacheMaxMetadataBytes}).then(refreshCache); }
  clearCache.onclick = async () => {
    if (clearingCache) return; clearingCache = true; cacheVersion++; clearCache.disabled = true; cacheUsage.textContent = '正在清理缓存…';
    const cleared = await cache.clear(); clearingCache = false;
    if (cleared) { await refreshCache(); cacheUsage.textContent = `缓存已清理 · ${cacheUsage.textContent}`; } else { cacheUsage.textContent = '缓存清理失败，请重试。'; clearCache.disabled = false; }
  };
  let cacheRefreshTimer;
  const unsubscribeCache = cache?.subscribe(() => { if (!mask.hidden) { context.clearTimeout(cacheRefreshTimer); cacheRefreshTimer=context.setTimeout(refreshCache,80); } });
  context.addEventListener('pagehide', () => { unsubscribeCache?.(); context.clearTimeout(cacheRefreshTimer); });
  function sync() { for (const [key,c] of controls) { if (c.type === 'checkbox') c.checked = ['smoothNavigation','cacheEnabled','autoListRefresh'].includes(key) ? prefs[key] !== false : !!prefs[key]; else c.value = prefs[key] ?? ({fontScale:1,font:'system',theme:'light',cacheMaxPosts:500}[key]); } sheet.querySelector('.rt-scale').textContent = `${Math.round(Number(controls.get('fontScale').value) * 100)}%`; }
  const account = document.createElement('button'); account.className = 'rt-account'; account.textContent = '登录'; account.onclick = () => { hide(true, true); login?.(account); }; if (login) header.insertBefore(account, close);
  let opener = fab, sheetAnimation, animationVersion = 0, closing = false;
  const measurePanel = () => app.style.setProperty('--rt-panel-height', `${Math.ceil(sheet.getBoundingClientRect().height)}px`);
  const panelObserver = typeof context.ResizeObserver === 'function' ? new context.ResizeObserver(measurePanel) : null;
  panelObserver?.observe(sheet);
  context.addEventListener('pagehide', () => { panelObserver?.disconnect(); syncThemeMetadata(false); });
  function motionFrames() {
    const source = opener.getBoundingClientRect(), target = sheet.getBoundingClientRect();
    const x = source.left + source.width / 2 - target.left - target.width / 2;
    const y = source.top + source.height / 2 - target.top - target.height / 2;
    return [{opacity:0,transform:`translate(${x * .16}px,${y * .12}px) scale(.92)`},{opacity:1,transform:'translate(0,0) scale(1)'}];
  }
  const canAnimate = () => typeof sheet.animate === 'function' && !context.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function hide(restoreFocus = true, immediate = false) {
    if (mask.hidden) return;
    const version = ++animationVersion; sheetAnimation?.cancel(); closing = true;
    fab.setAttribute('aria-expanded','false');
    const finish = () => {
      if (version !== animationVersion) return;
      if (typeof mask.close === 'function' && mask.open) mask.close(); else mask.removeAttribute('open');
      mask.hidden = true; closing = false; app.classList.remove('rt-settings-open');
      if (!shadow.querySelector('.board-dialog[open]')) {
        document.documentElement.removeAttribute('data-readscape-modal-open');
      }
      if (restoreFocus && opener.isConnected && !app.hidden) opener.focus({ preventScroll: true });
    };
    if (!immediate && canAnimate()) {
      sheetAnimation = sheet.animate(motionFrames().reverse(), {duration:180,easing:'cubic-bezier(.4,0,1,1)',fill:'forwards'});
      sheetAnimation.finished.then(finish, () => {});
    } else finish();
  }
  function open(trigger = fab) {
    if (!mask.hidden && !closing) return;
    animationVersion++; closing = false; sheetAnimation?.cancel();
    sync(); readerActions.querySelectorAll('a').forEach(a => a.refreshHref?.()); opener = trigger; mask.hidden = false;
    document.documentElement.setAttribute('data-readscape-modal-open', '');
    if (!mask.open) { if (typeof mask.show === 'function') mask.show(); else mask.setAttribute('open', ''); }
    app.classList.add('rt-settings-open'); measurePanel();
    refreshCache();
    if (canAnimate()) sheetAnimation = sheet.animate(motionFrames(), {duration:260,easing:'cubic-bezier(.2,.8,.2,1)'});
    fab.setAttribute('aria-expanded','true'); close.focus({ preventScroll: true });
  }
  fab.onclick = () => open();
  mask.addEventListener('cancel', event => { event.preventDefault(); hide(); });
  close.onclick = () => hide(); native.onclick = () => { hide(true, true); original(); };
  reset.onclick = () => { Object.assign(prefs,{fontScale:1,font:'system',theme:'light',single:false,groupReplies:false,smoothNavigation:true,autoListRefresh:true,cacheEnabled:true,cacheMaxPosts:500}); save(); sync(); apply(); configureCache(); change(); };
  mask.onclick = e => { if (e.target === mask) hide(); };
  mask.addEventListener('touchmove', event => {
    if (event.target === mask) {
      if (event.cancelable) event.preventDefault();
    }
  }, { passive: false });
  mask.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); }
  });
  mask.append(sheet); shadow.append(fab, mask); sync(); apply(); configureCache();
  return {
    sync, open,
    setAccount(info) {
      account.replaceChildren();
      if (!info) { account.textContent = '未登录 · 登录'; account.setAttribute('aria-label', '未登录，登录 NGA'); return; }
      const name = document.createElement('span'); name.className = 'account-name'; name.textContent = info.username;
      const uid = document.createElement('span'); uid.className = 'account-uid'; uid.textContent = `UID ${info.uid}`;
      account.append(name, uid); account.setAttribute('aria-label', `${info.username}，UID ${info.uid}，查看个人资料`);
    },
    setActions(items) {
      readerActions.replaceChildren(); readerActions.hidden = !items.length;
      return items.map(({ label, className, action, href, target = '_top' }) => {
        const control = document.createElement(href ? 'a' : 'button'); if (!href) control.type = 'button'; control.className = className; control.textContent = label;
        if (href) { control.href = href(); control.target = target; if (target === '_blank') control.rel = 'noopener noreferrer'; control.dataset.readscapeNative = 'true'; control.refreshHref = () => { control.href = href(); }; }
        control.onclick = () => { control.refreshHref?.(); hide(true, true); action?.(); }; readerActions.append(control); return control;
      });
    },
    visibility(enabled) { fab.hidden = !enabled; if (!enabled) hide(false, true); syncThemeMetadata(enabled); }
  };
}
