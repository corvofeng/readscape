  function startReader() {
    const tid = pageURL.searchParams.get('tid');
    const pages = new Map(), records = new Map(), cards = new Map();
    let initialSignature = '', busy = false, ended = false, scanTimer, cursor;
    const nativePage = Number(pageURL.searchParams.get('page')) || 1;
    cursor = nativePage;
    const canonical = (page = nativePage) => {
      const u = new URL(pageURL.href);
      ['rand', 'topid', 'pid'].forEach(k => u.searchParams.delete(k));
      u.searchParams.set('page', String(page)); u.hash = ''; return u;
    };
    const style = node('style', '', /* READER_CSS */);
    shadow.append(style);
    app.classList.add('reader');
    const rtop = node('header', 'top'), rbar = node('div', 'bar');
    const rrestore = button('优雅阅读', 'restore', () => setMode(true)); rrestore.hidden = true;
    const rmain = node('main'), rhead = node('div', 'reader-head');
    const rtitle = node('h1', '', document.title.replace(/\s*NGA玩家社区.*$/, ''));
    const rsub = node('div', 'sub', '按原站分页阅读 · 引用默认折叠');
    rhead.append(rtitle, rsub);
    rbar.append(node('div', 'brand', 'NGA · 阅读'), node('div', 'spacer'), button('原版 / 回复', 'pill', () => setMode(false)));
    rtop.append(rbar);
    const rviews = node('nav', 'tabs'); rviews.setAttribute('aria-label', '评论排列');
    for (const [value, label] of [[false, '楼层顺序'], [true, '关联对话']]) {
      const b = button(label, '', () => { prefs.groupReplies = value; savePrefs(); renderReader(); });
      b.dataset.group = String(value); rviews.append(b);
    }
    const stream = node('div', 'reader-stream');
    const bottom = node('div', 'reader-bottom'), status = node('div', 'reader-status'); status.setAttribute('role', 'status');
    const load = button('加载下一页', 'load-next', async () => {
      if (busy || ended) return;
      while (pages.has(cursor + 1)) cursor++;
      const next = cursor + 1;
      await loadPage(next, true);
      if (pages.has(next)) cursor = next;
      renderReader();
    });
    bottom.append(load, status, node('div', 'reader-footer', '每次只加载一页 · 回复与点赞使用原版操作'));
    rmain.append(rhead, rviews, stream, bottom); app.replaceChildren(rtop, rmain);
    const dock = node('nav', 'reader-dock'); dock.setAttribute('aria-label', '移动端阅读操作');
    const dockCount = button('评论', 'dock-count', () => {
      stream.querySelector('.comment:not(.op)')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    dock.append(button('回复帖子…', 'reply-entry', () => {
      setMode(false); document.querySelector('#postbtop, #postbbtm')?.scrollIntoView({ block: 'center' });
    }), dockCount, button('顶部 ↑', 'dock-top', () => app.scrollTo({ top: 0, behavior: 'smooth' })));
    app.append(dock);
    restore.remove(); shadow.append(rrestore);
    modeToggle = setMode;
    settingsRefresh = renderReader;

    function setMode(enabled) {
      prefs.enabled = enabled; savePrefs();
      app.hidden = !enabled || !pages.size; rrestore.hidden = enabled || !pages.size;
      document.documentElement.style.overflow = app.hidden ? originalOverflow : 'hidden';
      setViewport(!app.hidden);
    readingSettings?.visibility(!app.hidden);
    if (!app.hidden) navigation.finish();
    }

    function parsePosts(doc, base) {
      const output = [], localSeen = new Set();
      for (const content of doc.querySelectorAll('.postcontent, [id^="postcontent"]')) {
        if (!/^postcontent\d+$/.test(content.id) && !content.classList.contains('postcontent')) continue;
        const index = content.id.match(/(\d+)$/)?.[1];
        const row = content.closest('tr') || doc.getElementById(`post1strow${index}`);
        const container = content.closest('[id^="postcontainer"]') || row;
        if (!row || !container) continue;
        const floorLink = [...row.querySelectorAll('a')].find(a => /^#\d+$/.test(a.textContent.trim()));
        const floor = floorLink ? Number(floorLink.textContent.trim().slice(1)) : null;
        const anchor = container.querySelector('a[id^="pid"][id$="Anchor"]');
        const pid = anchor?.id.match(/^pid(\d+)Anchor$/)?.[1] || null;
        const key = pid != null ? `pid:${pid}` : floor != null ? `floor:${floor}` : `index:${index}:${base}`;
        if (localSeen.has(key)) continue; localSeen.add(key);
        const author = doc.getElementById(`postauthor${index}`) || row.querySelector('.author');
        const date = doc.getElementById(`postdate${index}`) || row.querySelector('.postdatec');
        const original = new URL(base); original.hash = pid ? `pid${pid}Anchor` : `l${floor ?? index}`;
        const quotes = [...content.querySelectorAll('.quote, blockquote')].filter(q => !q.parentElement?.closest('.quote, blockquote'));
        const refs = quotes.map(q => {
          const a = [...q.querySelectorAll('a[href]')].find(a => {
            const u = safeURL(a.getAttribute('href'), base); return u?.origin === pageURL.origin && u.searchParams.get('tid') === tid && u.searchParams.has('topid');
          });
          const u = a && safeURL(a.getAttribute('href'), base);
          return u ? { pid: u.searchParams.get('topid'), url: u.href, author: q.querySelector('.userlink')?.textContent.trim() || '' } : null;
        }).filter(Boolean);
        output.push({ key, pid, floor, author: author?.textContent.trim() || '匿名用户', time: date?.textContent.trim() || '', content, refs, original: original.href, base, native: doc === document ? container : null });
      }
      return output;
    }

    function updateNative() {
      autoContinue();
      const posts = parsePosts(document, location.href);
      if (!posts.length) return;
      const sig = posts.map(p => `${p.key}|${p.author}|${p.time}|${p.content.outerHTML}`).join('\n');
      if (sig === initialSignature) return; initialSignature = sig;
      const detectedPage = [...document.querySelectorAll('#pagebtop .invert, #pagebbtm .invert')].map(x => Number(x.textContent.replace(/\p{M}/gu, '').trim())).find(x => x > 0);
      const p = detectedPage || (pageURL.searchParams.get('page') === 'e' && posts[0].floor != null ? Math.floor(posts[0].floor / 20) + 1 : nativePage);
      if (!pages.size) cursor = p;
      pages.set(p, posts); rebuildRecords();
      rtitle.textContent = document.querySelector('#postsubject0')?.textContent.trim() || document.title.replace(/\s*NGA玩家社区.*$/, '');
      if (!rbar.querySelector('a')) {
        const board = [...document.querySelectorAll('#m_nav a[href*="thread.php"]')].at(-1);
        const u = board && safeURL(board.getAttribute('href'));
        if (u) rbar.insertBefore(link(u.href, '返回板块', 'pill'), rbar.lastChild);
      }
      renderReader(); setMode(!!prefs.enabled);
      const targetPid = pageURL.hash.match(/pid(\d+)/)?.[1];
      if (targetPid) setTimeout(() => focusRecord(`pid:${targetPid}`), 50);
    }

    function rebuildRecords() {
      records.clear(); for (const list of pages.values()) for (const p of list) records.set(p.key, p);
    }

    function sanitized(source, base) {
      const fragment = document.createDocumentFragment();
      const allowed = new Set(['P','DIV','SPAN','BR','B','STRONG','EM','I','U','S','DEL','PRE','CODE','UL','OL','LI','TABLE','THEAD','TBODY','TR','TD','TH','H1','H2','H3','H4','HR','DETAILS','SUMMARY','FONT']);
      const copy = (child, dest) => {
        if (child.nodeType === 3) { dest.append(document.createTextNode(child.textContent)); return; }
        if (child.nodeType !== 1 || ['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','SVG'].includes(child.tagName)) return;
        if (child.matches('.quote, blockquote')) {
          const detail = node('details', 'quoted'), title = node('summary');
          const raw = child.textContent.replace(/\s+/g, ' ').replace(/\(undefined\)/g, '').trim();
          const excerpt = raw.replace(/^[+R\s]*by\s*/i, '');
          title.textContent = `引用 · ${excerpt.slice(0, 85)}${excerpt.length > 85 ? '…' : ''}`;
          const body = node('div', 'quoted-body');
          for (const c of child.childNodes) copy(c, body);
          const target = [...child.querySelectorAll('a[href]')].map(a => safeURL(a.getAttribute('href'), base)).find(u => u?.origin === pageURL.origin && u.searchParams.get('tid') === tid && u.searchParams.has('topid'));
          detail.append(title, body);
          if (target) detail.append(button('查看原楼 ↗', 'context', () => showContext(target)));
          dest.append(detail); return;
        }
        if (child.tagName === 'IMG') {
          if (child.getAttribute('style')?.includes('display:none') || child.getAttribute('style')?.includes('display: none')) return;
          const u = safeURL(child.getAttribute('data-src') || child.getAttribute('data-original') || child.getAttribute('src'), base);
          if (!u) return;
          const img = node('img'); img.src = u.href; img.alt = child.getAttribute('alt') || ''; img.loading = 'lazy'; img.referrerPolicy = 'same-origin';
          if (/smile|emotion/i.test(u.href) || /smile/.test(child.className)) { img.className = 'emoji'; dest.append(img); }
          else { const attachment = link(u.href, '', 'attachment'); attachment.setAttribute('aria-label', img.alt || '查看完整图片'); attachment.append(img); dest.append(attachment); }
          return;
        }
        if (child.tagName === 'A') {
          const u = safeURL(child.getAttribute('href'), base);
          if (!u) { if (!/^[+R]$/.test(child.textContent.trim())) for (const c of child.childNodes) copy(c, dest); return; }
          const a = link(u.href, ''); a.rel = 'noopener noreferrer';
          for (const c of child.childNodes) copy(c, a); dest.append(a); return;
        }
        const tag = allowed.has(child.tagName) ? (child.tagName === 'FONT' ? 'span' : child.tagName.toLowerCase()) : 'span';
        const el = node(tag); if (child.tagName === 'DETAILS' && child.hasAttribute('open')) el.open = true;
        for (const c of child.childNodes) copy(c, el); dest.append(el);
      };
      for (const child of source.childNodes) copy(child, fragment);
      return fragment;
    }

    function makeComment(p, parent) {
      const op = p.floor === 0;
      const card = node('article', `comment${op ? ' op' : ''}`); card.dataset.key = p.key; card.style.setProperty('--bg', color(p.pid || String(p.floor || 0)));
      const head = node('header', 'comment-head'), identity = node('div', 'reader-identity');
      const name = node('div', 'reader-author', p.author); if (op) name.append(node('span', 'op-label', '楼主'));
      identity.append(name, node('div', 'comment-date', p.time));
      head.append(node('div', 'reader-avatar', p.author.replace(/^UID:/, '').slice(0, 1) || 'N'), identity, link(p.original, op ? '首楼' : `#${p.floor ?? '?'}`, 'floor'));
      const body = node('div', 'comment-content'); body.append(sanitized(p.content, p.base));
      const actions = node('div', 'comment-actions');
      actions.append(node('span', 'action-date', p.time), button('原版回复', '', () => {
        setMode(false);
        if (p.native) p.native.scrollIntoView({ block: 'center' }); else location.href = p.original;
      }), link(p.original, '原楼链接'));
      card.append(head);
      if (parent) card.append(node('div', 'reply-rel', `回复 #${parent.floor ?? '?'} · ${parent.author}`));
      card.append(body, actions); cards.set(p.key, card); return card;
    }

    function renderReader() {
      const scroll = app.scrollTop; cards.clear(); stream.replaceChildren();
      for (const b of rviews.children) b.setAttribute('aria-pressed', String(b.dataset.group === String(!!prefs.groupReplies)));
      // 同页关系图仅接受一个明确引用，且只能指向较早的非首楼，避免误合并和循环。
      for (const [number, posts] of [...pages].sort((a, b) => a[0] - b[0])) {
        const section = node('section', 'reader-page'); section.dataset.page = number;
        section.append(node('div', 'page-heading', `第 ${number} 页 · ${posts.length} 个楼层`));
        const local = new Map(posts.map(p => [p.key, p])), children = new Map(), parents = new Map();
        if (prefs.groupReplies) for (const p of posts) if (p.refs.length === 1) {
          const parent = local.get(`pid:${p.refs[0].pid}`);
          if (parent && parent.floor > 0 && p.floor > parent.floor) {
            parents.set(p.key, parent); if (!children.has(parent.key)) children.set(parent.key, []); children.get(parent.key).push(p);
          }
        }
        const descendants = root => { const out = []; for (const p of children.get(root.key) || []) { out.push(p, ...descendants(p)); } return out; };
        for (const p of posts) {
          if (parents.has(p.key)) continue;
          section.append(makeComment(p));
          const replies = descendants(p).sort((a, b) => a.floor - b.floor);
          if (replies.length) {
            const thread = node('details', 'thread'); thread.append(node('summary', '', `展开 ${replies.length} 条关联回复`));
            for (const reply of replies) thread.append(makeComment(reply, parents.get(reply.key)));
            section.append(thread);
          }
        }
        stream.append(section);
      }
      rsub.textContent = `已加载 ${pages.size} 页 · ${records.size} 个楼层 · 引用默认折叠`;
      dockCount.textContent = `评论 ${[...records.values()].filter(p => p.floor !== 0).length}`;
      load.disabled = busy || ended; load.textContent = busy ? '正在加载…' : ended ? '已到末页' : '加载下一页';
      app.scrollTop = scroll;
    }

    function focusRecord(key) {
      const card = cards.get(key); if (!card) return false;
      let parent = card.parentElement; while (parent && parent !== app) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
      card.scrollIntoView({ block: 'center', behavior: 'smooth' }); card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1700); return true;
    }

    async function showContext(u) {
      const key = `pid:${u.searchParams.get('topid')}`;
      if (focusRecord(key)) return;
      const page = Number(u.searchParams.get('page'));
      if (Number.isInteger(page) && page > 0) {
        await loadPage(page);
        if (focusRecord(key)) return;
      }
      status.replaceChildren(node('span', '', '原楼暂未解析到，可在原站查看： '), link(u.href, '打开原楼'));
    }

    async function loadPage(number, advance = false) {
      if (pages.has(number) || busy || !Number.isInteger(number) || number < 1) return;
      busy = true; renderReader(); status.textContent = `正在读取第 ${number} 页…`;
      const u = canonical(number), controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(u.href, { credentials: 'same-origin', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const finalURL = safeURL(response.url || u.href);
        if (!finalURL || finalURL.origin !== pageURL.origin || finalURL.searchParams.get('tid') !== tid) throw new Error('原站返回了其他页面');
        const bytes = new Uint8Array(await response.arrayBuffer()), initial = new TextDecoder('utf-8').decode(bytes);
        const encoding = response.headers.get('content-type')?.match(/charset\s*=\s*([\w-]+)/i)?.[1] || initial.slice(0,4096).match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || 'utf-8';
        const doc = new DOMParser().parseFromString(new TextDecoder(encoding).decode(bytes), 'text/html');
        const all = parsePosts(doc, u.href), fresh = all.filter(p => !records.has(p.key));
        if (!all.length) throw new Error('需要原站跳转、登录，或页面结构不支持');
        if (!fresh.length) { if (advance) ended = true; status.textContent = '原站未返回新的楼层，已停止重复加载。'; return; }
        pages.set(number, fresh); rebuildRecords(); status.textContent = `已加载第 ${number} 页`;
      } catch (error) {
        status.replaceChildren(node('span', '', `${error.name === 'AbortError' ? '加载超时' : error.message}。 `), link(u.href, `直接打开第 ${number} 页`));
      } finally { clearTimeout(timeout); busy = false; renderReader(); }
    }

    updateNative();
    const nativeObserver = new MutationObserver(() => { clearTimeout(scanTimer); scanTimer = setTimeout(updateNative, 250); });
    nativeObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener('pagehide', () => { nativeObserver.disconnect(); clearTimeout(scanTimer); clearTimeout(gateTimer); });
  }

