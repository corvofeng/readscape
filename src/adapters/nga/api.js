// ========================================================
// NGA Data / API Layer (前后端分离 - 数据层)
// 纯数据逻辑：负责网络请求、字符集解码、状态嗅探与原生 HTML 结构提取
// 不接触任何 UI DOM 渲染逻辑
// ========================================================

function createNGAApi({ pageURL, safeURL }) {
  async function fetchDoc(url, { signal, cache = 'default' } = {}) {
    const response = await fetch(url, { credentials: 'same-origin', cache, signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
    const doc = new DOMParser().parseFromString(new TextDecoder(encoding).decode(bytes), 'text/html');
    return { doc, responseURL: response.url || url };
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

  function isVisitorGate(doc) {
    return doc?.title === '访客不能直接访问';
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
    if (!items.length) throw new Error('需要原站跳转、登录，或页面结构不支持');
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
    hasThreadContent,
    extractTopics,
    fetchListPage,
    fetchThreadDoc
  };
}
