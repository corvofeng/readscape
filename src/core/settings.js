function mountSettings({ shadow, app, prefs, save, change, original }) {
  const style = document.createElement('style');
  style.textContent = `
    .rt-mask[hidden],.rt-fab[hidden]{display:none!important}
    .rt-fab{position:fixed;right:16px;bottom:calc(82px + env(safe-area-inset-bottom));z-index:2147483010;width:48px;height:48px;border:1px solid #eee;border-radius:17px;background:#fff;color:#555;box-shadow:0 4px 20px #0002;font-size:23px}
    .rt-mask{position:fixed;inset:0;z-index:2147483011;background:#0004;display:flex;align-items:flex-end;justify-content:center}.rt-sheet{background:#fff;color:#333;width:min(100%,440px);max-height:85dvh;overflow:auto;padding:20px 22px calc(22px + env(safe-area-inset-bottom));border-radius:24px 24px 0 0;box-shadow:0 -10px 40px #0001;font:14px/1.5 system-ui}.rt-sheet h2{font-size:18px;margin:0}.rt-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}.rt-sheet label{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:48px}.rt-sheet select{max-width:180px;padding:8px;border:1px solid #eee;border-radius:10px;background:#f7f7f9;color:#333;font:inherit}.rt-sheet input[type=range]{width:150px;accent-color:#ff2442}.rt-sheet input[type=checkbox]{accent-color:#ff2442;width:18px;height:18px}.rt-sheet button{min-height:44px;padding:8px 14px;border-radius:14px;background:#f5f5f7}.rt-actions{display:flex;gap:10px;margin-top:14px}.rt-note{font-size:12px;color:#999;margin:8px 0}
    .app{font-family:var(--rt-font,system-ui);max-width:100vw;overflow-x:hidden;text-size-adjust:100%;-webkit-text-size-adjust:100%}.app main,.grid,.bar{min-width:0;width:100%}.grid>.card{min-width:0;max-width:100%}
    .app .comment-content{font-size:calc(15px * var(--rt-scale,1))}.app .comment.op .comment-content{font-size:calc(16px * var(--rt-scale,1))}.app .thread .comment-content{font-size:calc(14px * var(--rt-scale,1))}.app .mobile-caption,.app .image-title{font-size:calc(14px * var(--rt-scale,1))}.app .cover .title{font-size:calc(18px * var(--rt-scale,1))}
    .app.rt-paper{background:#f6f2e9}.app.rt-paper .top,.app.rt-paper .card,.app.rt-paper .comment.op,.app.rt-paper .reader-dock{background:#faf7ef}.app.rt-dark{background:#17191d;color:#e0e0e5;color-scheme:dark}.app.rt-dark .top,.app.rt-dark .card,.app.rt-dark .comment,.app.rt-dark .reader-dock{background:#202329;border-color:#34373e}.app.rt-dark .comment-content,.app.rt-dark .tabs button[aria-selected=true],.app.rt-dark .tabs button[aria-pressed=true]{color:#eee}.app.rt-dark .quoted,.app.rt-dark .search input,.app.rt-dark .reply-entry,.app.rt-dark .load-next{background:#2c3038;color:#bbb}.app.rt-dark .cover:not(.has-image){background:#30343d}.app.rt-dark .cover .title,.app.rt-dark .eyebrow{color:#ddd}.app.rt-dark .tag{background:#444;color:#ddd}
    @media(min-width:601px){.rt-mask{align-items:center}.rt-sheet{border-radius:24px}.rt-fab{bottom:24px}.app .cover .title{font-size:calc(20px * var(--rt-scale,1))}.app .image-title{font-size:calc(16px * var(--rt-scale,1))}}
  `;
  shadow.append(style);
  const fab = document.createElement('button'); fab.type = 'button'; fab.className = 'rt-fab'; fab.textContent = '⚙'; fab.setAttribute('aria-label', '阅读设置'); fab.setAttribute('aria-expanded', 'false');
  const mask = document.createElement('div'); mask.className = 'rt-mask'; mask.hidden = true;
  const sheet = document.createElement('section'); sheet.className = 'rt-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', '阅读设置'); sheet.tabIndex = -1;
  const header = document.createElement('div'); header.className = 'rt-header';
  const title = document.createElement('h2'); title.textContent = '阅读设置';
  const close = document.createElement('button'); close.textContent = '完成'; header.append(title, close); sheet.append(header);
  const controls = new Map();
  function apply() {
    const scale = Math.min(1.4, Math.max(.85, Number(prefs.fontScale) || 1));
    app.style.setProperty('--rt-scale', scale);
    app.style.setProperty('--rt-font', prefs.font === 'serif' ? '"Songti SC","Noto Serif CJK SC",serif' : prefs.font === 'rounded' ? 'ui-rounded,"Arial Rounded MT Bold","PingFang SC",sans-serif' : '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif');
    app.classList.toggle('rt-paper', prefs.theme === 'paper'); app.classList.toggle('rt-dark', prefs.theme === 'dark');
  }
  function row(label, key, type, options) {
    const wrap = document.createElement('label'); const text = document.createElement('span'); text.textContent = label;
    const c = document.createElement(type === 'select' ? 'select' : 'input'); c.setAttribute('aria-label', label); c.dataset.pref = key;
    if (type === 'select') for (const [value, name] of options) { const opt = document.createElement('option'); opt.value = value; opt.textContent = name; c.append(opt); }
    else { c.type = type; if (type === 'range') { c.min = '.85'; c.max = '1.4'; c.step = '.05'; } }
    const update = () => { prefs[key] = type === 'checkbox' ? c.checked : type === 'range' ? Number(c.value) : c.value; save(); apply(); change(); };
    c.addEventListener(type === 'range' ? 'input' : 'change', update); controls.set(key, c); wrap.append(text, c); sheet.append(wrap);
  }
  row('字号', 'fontScale', 'range'); row('字体', 'font', 'select', [['system','系统字体'],['serif','宋体 / 衬线'],['rounded','圆润字体']]);
  row('配色', 'theme', 'select', [['light','明亮'],['paper','暖纸'],['dark','深色']]);
  row('手机单列', 'single', 'checkbox'); row('关联楼层回复', 'groupReplies', 'checkbox'); row('平滑跳转过渡', 'smoothNavigation', 'checkbox');
  const note = document.createElement('p'); note.className = 'rt-note'; note.textContent = '字体使用设备现有字体。单双列适用于列表，关联回复适用于评论。'; sheet.append(note);
  const actions = document.createElement('div'); actions.className = 'rt-actions';
  const reset = document.createElement('button'); reset.textContent = '恢复默认';
  const native = document.createElement('button'); native.textContent = '查看原版'; actions.append(reset, native); sheet.append(actions);
  function sync() { for (const [key,c] of controls) { if (c.type === 'checkbox') c.checked = key === 'smoothNavigation' ? prefs[key] !== false : !!prefs[key]; else c.value = prefs[key] ?? ({fontScale:1,font:'system',theme:'light'}[key]); } }
  function hide() { mask.hidden = true; fab.setAttribute('aria-expanded','false'); fab.focus(); }
  fab.onclick = () => { sync(); mask.hidden = false; fab.setAttribute('aria-expanded','true'); close.focus(); };
  close.onclick = hide; native.onclick = () => { hide(); original(); };
  reset.onclick = () => { Object.assign(prefs,{fontScale:1,font:'system',theme:'light',single:false,groupReplies:false,smoothNavigation:true}); save(); sync(); apply(); change(); };
  mask.onclick = e => { if (e.target === mask) hide(); };
  mask.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); hide(); }
    if (e.key === 'Tab') { const list = [...sheet.querySelectorAll('button,input,select')]; const first=list[0], last=list.at(-1); if (e.shiftKey && shadow.activeElement===first) {e.preventDefault();last.focus();} else if (!e.shiftKey && shadow.activeElement===last) {e.preventDefault();first.focus();} }
  });
  mask.append(sheet); shadow.append(fab, mask); apply();
  return { sync, visibility(enabled) { fab.hidden = !enabled; if (!enabled) mask.hidden = true; } };
}
