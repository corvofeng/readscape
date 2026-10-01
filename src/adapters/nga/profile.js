function mountUserProfiles() {
  const cache = new Map(), requests = new Map();
  function avatarURL(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    let value = raw.split('|')[0].trim();
    const short = value.match(/^\.a\/(\d+)_(\d+)\.(jpg|png|gif|webp(?:\.jpg)?)(\?\d+)?$/);
    if (short) {
      const hex = Number(short[1]).toString(16).padStart(9, '0').slice(-9);
      const path = `${hex.slice(6)}/${hex.slice(3,6)}/${hex.slice(0,3)}`;
      value = `https://img.nga.cn/avatars/2002/${path}/${short[1]}_${short[2]}.${short[3]}${short[4] || ''}`;
    } else if (/^[\w-]+\.(?:gif|jpg|png|webp)$/.test(value)) value = `https://img4.nga.cn/ngabbs/face/${value}`;
    return safeURL(value, pageURL)?.href || null;
  }
  function normalize(user, groups = {}) {
    if (!user || !/^\d+$/.test(String(user.uid)) || Number(user.uid) <= 0) return null;
    const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
    return {
      uid: String(user.uid), username: String(user.username || '用户'), avatar: avatarURL(user.avatar),
      regdate: number(user.regdate), rank: user.group || groups[user.memberid]?.[0] || groups[user.groupid]?.[0] || null,
      rvrc: number(user.rvrc), money: number(user.money), posts: number(user.postnum ?? user.posts)
    };
  }
  function resolve(info) {
    const uid = String(info.uid || '');
    if (!/^\d+$/.test(uid) || Number(uid) <= 0) return null;
    const table = readNGAUserData(document, window);
    const user = info.profile || normalize(table.users[uid], table.groups);
    return user?.regdate != null ? user : cache.get(uid) || user || null;
  }
  function image(url, className) {
    const img = node('img', className); img.src = url; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => { img.remove(); }); return img;
  }
  function decorate(control, info, avatarOnly = false) {
    if (!info?.uid) { delete control.dataset.userUid; control.querySelector('.user-avatar-image')?.remove(); return; }
    control.dataset.userUid = info.uid; control.dataset.avatarOnly = String(avatarOnly);
    const user = resolve(info), url = user?.avatar;
    control.setAttribute('aria-label', `${info.author || info.username || user?.username || '用户'}，查看用户资料`);
    if (control.querySelector('.user-avatar-image')?.getAttribute('src') === url) return;
    control.querySelector('.user-avatar-image')?.remove();
    if (url) control.prepend(image(url, `user-avatar-image${avatarOnly ? '' : ' account-picture'}`));
  }
  async function load(uid) {
    if (requests.has(uid)) return requests.get(uid);
    const request = (async () => {
      const url = new URL('/nuke.php', pageURL); url.searchParams.set('func', 'ucp'); url.searchParams.set('uid', uid);
      const controller = new window.AbortController(); const timer = window.setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(url.href, { credentials: 'same-origin', signal: controller.signal });
        if (!response.ok || (response.url && new URL(response.url).origin !== pageURL.origin)) throw new Error('用户资料暂时无法读取');
        const buffer = await response.arrayBuffer();
        const charset = /charset=\s*([\w-]+)/i.exec(response.headers.get('content-type') || '')?.[1] || 'gb18030';
        const html = new window.TextDecoder(charset).decode(buffer);
        const doc = new window.DOMParser().parseFromString(html, 'text/html');
        const table = readNGAUserData(doc, window), user = normalize(table.users[uid], table.groups);
        if (!user || user.uid !== uid) throw new Error('原页未提供该用户资料');
        cache.set(uid, user);
        for (const control of shadow.querySelectorAll('[data-user-uid]')) if (control.dataset.userUid === uid) decorate(control, {uid, author:user.username, profile:user}, control.dataset.avatarOnly === 'true');
        return user;
      } finally { window.clearTimeout(timer); }
    })();
    requests.set(uid, request);
    try { return await request; } finally { requests.delete(uid); }
  }
  const style = node('style', '', `
    .user-trigger{padding:0;text-align:left;touch-action:manipulation}.avatar,.reader-avatar{position:relative;overflow:hidden}
    .avatar .user-avatar-image,.reader-avatar .user-avatar-image{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit}
    .account-picture{float:left;width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:7px}
    .user-card{position:fixed;z-index:2147483013;width:min(340px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;margin:0;padding:18px;border:1px solid #eee4e9;border-radius:20px;background:#fff8fa;color:#30272d;box-shadow:0 8px 40px #21132130;font:14px/1.6 system-ui}
    .user-card:not([open]){display:none}.user-card[data-theme=dark]{background:#29232a;color:#f3e4ed;border-color:#806d78}.user-card[data-theme=paper]{background:#faf5eb;color:#3c332d}
    .user-card-head{display:flex;align-items:center;gap:12px;padding-right:36px}.user-card-avatar{position:relative;overflow:hidden;width:64px;height:64px;border-radius:16px;background:#f5dce5;color:#a43d60;display:grid;place-items:center;font-size:24px;flex:none}.user-card-avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.user-card-name{font-size:17px;font-weight:650;overflow-wrap:anywhere}.user-card-uid{font-size:12px;opacity:.65}.user-card-close{position:absolute;right:10px;top:8px;min-width:40px;min-height:40px;font-size:23px}
    .user-card-details{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}.user-card-details div{min-width:0}.user-card-details dt{font-size:12px;opacity:.6}.user-card-details dd{margin:2px 0 0;overflow-wrap:anywhere}.user-card-details .wide{grid-column:1/-1}.user-card-status{font-size:12px;opacity:.65;margin:12px 0}.user-card-link{display:inline-block;padding:9px 14px;background:#f5dce5;color:#a43d60;border-radius:20px;font-size:12px}
  `);
  const panel = node('dialog', 'user-card'); panel.setAttribute('aria-label', '用户资料');
  const close = button('×', 'user-card-close', hide); close.setAttribute('aria-label', '关闭用户资料');
  const head = node('div', 'user-card-head'), portrait = node('div', 'user-card-avatar'), identity = node('div');
  const name = node('div', 'user-card-name'), uidLabel = node('div', 'user-card-uid'); identity.append(name, uidLabel); head.append(portrait, identity);
  const details = node('dl', 'user-card-details'), status = node('p', 'user-card-status'); status.setAttribute('role', 'status');
  const native = link('', '查看原版个人资料 ↗', 'user-card-link'); native.dataset.readscapeNative = 'true';
  panel.append(close, head, details, status, native); shadow.append(style, panel);
  let opener, generation = 0;
  function hide() { generation++; if (panel.open) { if (panel.close) panel.close(); else panel.removeAttribute('open'); } if (opener?.isConnected) opener.focus({preventScroll:true}); }
  function render(info, user) {
    name.textContent = user?.username || info.author || info.username || '用户'; uidLabel.textContent = info.uid ? `UID ${info.uid}` : '原页未提供 UID';
    portrait.replaceChildren(document.createTextNode(name.textContent.slice(0,1))); if (user?.avatar) portrait.append(image(user.avatar, ''));
    details.replaceChildren();
    function field(label, value, wide = false) { if (value === null || value === undefined || value === '') return; const group = node('div', wide ? 'wide' : ''); group.append(node('dt','',label),node('dd','',String(value))); details.append(group); }
    if (user?.regdate && !Number.isNaN(new Date(user.regdate*1000).getTime())) field('注册时间', new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(user.regdate*1000)), true);
    field('级别', user?.rank); field('威望', user?.rvrc == null ? null : user.rvrc / 10); field('发帖数', user?.posts);
    if (user?.money != null) { const amount = Math.max(0,Math.floor(user.money)), gold = Math.floor(amount/10000), silver = Math.floor(amount%10000/100), copper = amount%100; field('财富',[gold ? `${gold} 金币` : '',silver ? `${silver} 银币` : '',copper || !amount ? `${copper} 铜币` : ''].filter(Boolean).join(' ')); }
    native.hidden = !/^\d+$/.test(String(info.uid || '')) || Number(info.uid) <= 0;
    if (!native.hidden) { const url = new URL('/nuke.php',pageURL); url.searchParams.set('func','ucp'); url.searchParams.set('uid',info.uid); native.href=url.href; }
  }
  function position() {
    const rect = opener?.getBoundingClientRect(), width = panel.offsetWidth, height = panel.offsetHeight;
    const left = Math.max(12,Math.min(rect?.left || 12,window.innerWidth-width-12));
    const below = (rect?.bottom || 0)+8;
    const top = Math.max(12,Math.min(below,window.innerHeight-height-12));
    panel.style.left=`${left}px`; panel.style.top=`${top}px`;
  }
  async function show(info, trigger) {
    const token = ++generation; opener=trigger; panel.dataset.theme=prefs.theme || 'light';
    let user=resolve(info); render(info,user); status.textContent=''; status.hidden=true;
    if (!panel.open) { if (panel.show) panel.show(); else panel.setAttribute('open',''); }
    position(); close.focus({preventScroll:true});
    if (!info.uid || !/^\d+$/.test(String(info.uid)) || Number(info.uid)<=0) { status.hidden=false; status.textContent='原页未提供该用户的详细资料'; return; }
    if (!user || user.regdate === null) {
      status.hidden=false; status.textContent='正在读取用户资料…';
      try { user=await load(String(info.uid)); if (token !== generation || !panel.open) return; render(info,user); status.hidden=true; position(); }
      catch { if (token !== generation || !panel.open) return; status.textContent='暂时无法读取详细资料，可查看原版个人资料。'; }
    }
  }
  const dismiss = event => { if (panel.open && !event.composedPath().includes(panel) && !event.composedPath().includes(opener)) hide(); };
  const escape = event => { if (panel.open && event.key==='Escape') { event.preventDefault(); hide(); } };
  document.addEventListener('pointerdown',dismiss,true); document.addEventListener('keydown',escape,true);
  panel.addEventListener('cancel',event=>{event.preventDefault();hide();});
  window.addEventListener('pagehide',()=>{document.removeEventListener('pointerdown',dismiss,true);document.removeEventListener('keydown',escape,true);});
  return {show,decorate,normalize,avatarURL};
}
