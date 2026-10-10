// ========================================================
// NGA Data / API Layer (前后端分离 - 数据层)
// 纯数据逻辑：负责网络请求、字符集解码、状态嗅探与原生 HTML 结构提取
// 不接触任何 UI DOM 渲染逻辑
// ========================================================

function createNGAApi({ pageURL, safeURL }) {
  // 访客闸门：NGA 偶尔把正常浏览判成“访客直接访问”，回一页 (ERROR:15) 访客不能直接访问。
  // 那页的内联脚本里带着服务器现场签发的通行证（document.cookie='guestJs=…'），
  // 写回 cookie 再换个 rand 参数重发就能放行——等价于原页那个“如不能自动跳转 可点此链接”，
  // 但不必整页跳转。捡不到通行证、超出配额或 cookie 写不进就交回调用方走原有的整页兜底。
  const gate = { title: '访客不能直接访问', ttl: 3200000, retries: 2, guardWindow: 120000, guardLimit: 2, guardKey: 'nga-gate-' };

  function isGateHTML(html) {
    return typeof html === 'string' && html.includes(gate.title) && /\(\s*ERROR:/.test(html);
  }

  function extractGuestPass(html) {
    return /guestJs['"]?\s*=\s*([^;'"\s]+)/.exec(html || '')?.[1] || null;
  }

  function writeGuestPass(token) {
    const expires = new Date(Date.now() + gate.ttl).toUTCString(), epoch = 'Thu, 01 Jan 1970 00:00:00 GMT';
    // 个别 host 不接受 domain 属性，带域写不进去就退回仅当前主机再试一次。
    for (const scope of [`domain=${location.hostname};`, '']) {
      try {
        document.cookie = `guestJs=${token};${scope}path=/;expires=${expires};SameSite=Lax`;
        document.cookie = `lastpath=0;${scope}path=/;expires=${epoch}`;
        if (document.cookie.includes(`guestJs=${token}`)) return true;
      } catch { /* 禁用 cookie 时交给上层用整页流程处理 */ }
    }
    return false;
  }

  function gateRetryURL(url) {
    const u = new URL(url, pageURL.href);
    u.searchParams.set('rand', String(Math.floor(Math.random() * 1000)));
    return u.href;
  }

  // sessionStorage 配额：同一目标两分钟最多自愈两次，防止闸门循环。
  function gateGuardAllows(url) {
    let u;
    try { u = safeURL(url, pageURL.href) || new URL(url, pageURL.href); } catch { return false; }
    const key = gate.guardKey + (u.searchParams.get('stid') || u.searchParams.get('fid') || u.searchParams.get('tid') || u.searchParams.get('uid') || u.pathname);
    let state;
    try { state = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return false; }
    if (!state || Date.now() - state.start > gate.guardWindow) state = { start: Date.now(), count: 0 };
    if (state.count >= gate.guardLimit) return false;
    state.count++;
    try { sessionStorage.setItem(key, JSON.stringify(state)); return true; } catch { return false; }
  }

  function gateWait(ms, signal) {
    return new Promise((resolve, reject) => {
      const fail = () => {
        clearTimeout(timer);
        reject(signal?.reason || new (window.DOMException || Error)('Aborted', 'AbortError'));
      };
      const timer = setTimeout(() => { try { signal?.removeEventListener?.('abort', fail); } catch {} resolve(); }, ms);
      if (signal?.aborted) fail();
      else try { signal?.addEventListener?.('abort', fail, { once: true }); } catch {}
    });
  }

  async function requestDoc(url, { signal, cache }) {
    const response = await fetch(url, { credentials: 'same-origin', cache, signal });
    let bytes;
    if (typeof response.arrayBuffer === 'function') {
      bytes = new Uint8Array(await response.arrayBuffer());
    } else if (typeof response.text === 'function') {
      bytes = new TextEncoder().encode(await response.text());
    } else {
      throw new Error('Unsupported response body');
    }
    const initial = new TextDecoder('utf-8').decode(bytes);
    const encoding = response.headers?.get?.('content-type')?.match(/charset\s*=\s*([\w-]+)/i)?.[1]
      || initial.slice(0, 4096).match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]
      || 'utf-8';
    const html = new TextDecoder(encoding).decode(bytes);
    // 闸门偶尔也带 4xx 状态返回；正文里有通行证就照样当闸门处理，其余错误照旧抛出。
    if (!response.ok && !isGateHTML(html)) throw new Error(`HTTP ${response.status}`);
    return { doc: new DOMParser().parseFromString(html, 'text/html'), html, responseURL: response.url || url };
  }

  async function fetchDoc(url, { signal, cache = 'default' } = {}) {
    for (let attempt = 0; ; attempt++) {
      // 闸门页可能正卡在缓存里，重试一律绕过缓存。
      const result = await requestDoc(url, { signal, cache: attempt ? 'no-store' : cache });
      const pass = isVisitorGate(result.doc) ? extractGuestPass(result.html) : null;
      if (!pass || attempt >= gate.retries || !gateGuardAllows(url) || !writeGuestPass(pass)) return result;
      await gateWait(300 + Math.floor(Math.random() * 300), signal);
      url = gateRetryURL(url);
    }
  }

  function isDeletedDoc(doc) {
    if (!doc) return false;
    if (doc.querySelector?.('.postcontent, [id^="postcontent"], #postcontainer0')) return false;
    const title = (doc.title || '').trim();
    const text = doc.body?.textContent || '';
    return /ERROR:\s*62/i.test(text) || /ERROR:\s*62/i.test(title) ||
      title === '帖子被删除' || title === '主题被删除' ||
      /(?:ERROR:\s*62\s*\)?\s*>\s*)?帖子(?:不存在或)?(?:已[被经]|被)?删除/.test(text);
  }

  function isVisitorGate(source) {
    if (!source) return false;
    if (typeof source === 'string') return isGateHTML(source);
    return (source.title || '').trim() === gate.title || isGateHTML(source.body?.innerHTML || '');
  }

  function hasThreadContent(doc) {
    return !!doc?.querySelector?.('.postcontent, [id^="postcontent"], #postcontainer0');
  }

  function extractTopics(doc = document, base = pageURL.href) {
    const result = [], seen = new Set();
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

  async function fetchListPage(url, number, { signal, validListURL, nextListURL } = {}) {
    const { doc, responseURL } = await fetchDoc(url, { signal, cache: 'no-cache' });
    if (validListURL && !validListURL(responseURL, number)) throw new Error('原站返回了其他页面');
    const items = extractTopics(doc, url);
    if (!items.length) throw new Error(isVisitorGate(doc) ? '原站访客闸门未能自动放行，可能需要登录或稍后重试' : '需要原站跳转、登录，或页面结构不支持');
    const next = nextListURL ? nextListURL(doc, number, url) : null;
    return { url, items: items.map(item => ({ ...item, lastAccess: Date.now() })), next };
  }

  async function fetchThreadDoc(url, { signal } = {}) {
    return await fetchDoc(url, { signal });
  }

  return {
    fetchDoc,
    isDeletedDoc,
    isVisitorGate,
    isGateHTML,
    extractGuestPass,
    writeGuestPass,
    hasThreadContent,
    extractTopics,
    fetchListPage,
    fetchThreadDoc
  };
}
