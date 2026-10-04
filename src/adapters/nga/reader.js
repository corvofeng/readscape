  function startReader(options = {}) {
    const targetURL = options.targetURL || pageURL;
    const container = options.container || app;
    const tid = targetURL.searchParams.get('tid');
    postCache?.visit({ tid, url: targetURL.href });
    const pages = new Map(), records = new Map(), cards = new Map(), nextPages = new Map();
    let previousCards = new Map();
    let initialSignature = '', busy = false, ended = false, scanTimer, cursor;
    const nativePage = Number(targetURL.searchParams.get('page')) || 1;
    cursor = nativePage;
    const canonical = (page = nativePage) => {
      const u = new URL(targetURL.href);
      ['rand', 'topid', 'pid'].forEach(k => u.searchParams.delete(k));
      u.searchParams.set('page', String(page)); u.hash = ''; return u;
    };
    if (!shadow.querySelector('style[data-readscape-reader]')) {
      const style = node('style', '', /* READER_CSS */);
      style.dataset.readscapeReader = 'true';
      shadow.append(style);
    }
    container.classList.add('reader');
    container.tabIndex = -1;
    const rtop = node('header', 'top'), rbar = node('div', 'bar');
    const rrestore = button('优雅阅读', 'restore', () => setMode(true)); rrestore.hidden = true;
    const rmain = node('main'), rhead = node('div', 'reader-head');
    const rtitle = node('h1', '', (options.initialDoc?.querySelector?.('#postsubject0')?.textContent.trim() || options.initialDoc?.title || document.title).replace(/\s*NGA玩家社区.*$/, ''));
    const rsub = node('div', 'sub', '按原站分页阅读 · 引用默认折叠');
    rhead.append(rtitle, rsub);
    if (options.onBack) {
      const backBtn = button('‹ 列表', 'pill reader-back-btn', options.onBack);
      backBtn.setAttribute('aria-label', '返回帖子列表');
      rbar.append(backBtn);
    }
    const rAccountStatus = button('未登录', 'session-status', () => openLogin(rAccountStatus));
    rAccountStatus.setAttribute('aria-label', '未登录，登录 NGA');
    rAccountStatus.hidden = !options.container ? accountStatus.hidden : !!currentAccount();
    const activeAccountStatus = options.container ? rAccountStatus : accountStatus;
    rbar.append(node('div', 'brand', 'NGA · 阅读'), node('div', 'spacer'), activeAccountStatus);
    const readerMenu = mobileOptions.cloneNode(true);
    readerMenu.setAttribute('aria-label', '阅读设置与账号'); readerMenu.removeAttribute('aria-expanded');
    readerMenu.onclick = () => readingSettings.open(readerMenu); rbar.append(readerMenu);
    rtop.append(rbar);
    const stream = node('div', 'reader-stream');
    const bottom = node('div', 'reader-bottom'), status = node('div', 'reader-status'); status.setAttribute('role', 'status');
    const endMarker = node('div', 'reader-end', '已经到底了');
    const load = button('加载下一页', 'load-next', async () => {
      if (busy || ended || load.hidden) return;
      while (pages.has(cursor + 1)) cursor++;
      const next = cursor + 1;
      await loadPage(next, true);
      if (pages.has(next)) cursor = next;
      renderReader();
    });
    const footer = node('div', 'reader-footer');
    bottom.append(load, endMarker, status, footer);
    rmain.append(rhead, stream, bottom); container.replaceChildren(rtop, rmain);
    const [replyEntry, dockCount] = readingSettings.setActions([
      { label: '回复帖子', className: 'reply-entry', href: () => postURL(options.initialDoc || document, targetURL.href).href, target: '_blank' },
      { label: '评论', className: 'dock-count', action: () => stream.querySelector('.comment:not(.op)')?.scrollIntoView({ block: 'start', behavior: 'smooth' }) },
      { label: '回到顶部', className: 'dock-top', action: () => (usesDocumentScroll() ? window : container).scrollTo({ top: 0, behavior: 'smooth' }) }
    ]);
    const prevAccountChanged = accountChanged;
    accountChanged = info => {
      replyEntry.hidden = !info;
      footer.textContent = info ? '每次只加载一页 · 回复与引用在新标签页打开原版发帖页' : '每次只加载一页';
      for (const card of cards.values()) syncCommentActions(card, card.readerPost, !!info);
      rAccountStatus.hidden = !!info;
      if (options.container) prevAccountChanged(info);
    };
    accountChanged(currentAccount());
    if (!options.container) {
      restore.remove(); shadow.append(rrestore);
    }
    const prevModeToggle = modeToggle;
    const prevSettingsRefresh = settingsRefresh;
    modeToggle = setMode;
    settingsRefresh = renderReader;

    function setMode(enabled) {
      const readingPosition = getReadingScroll();
      if (!enabled) closeViewer();
      prefs.enabled = enabled; savePrefs();
      container.hidden = !enabled || !pages.size; rrestore.hidden = enabled || !pages.size;
      setViewport(!container.hidden);
      setSurface(!container.hidden, readingPosition);
      readingSettings?.visibility(!container.hidden);
      if (!container.hidden) navigation.finish();
    }

    function postURL(doc, base, post, action = 'reply') {
      const links = [...doc.querySelectorAll('a[href]')].filter(a => !a.closest('.postcontent,[id^=postcontent],.quote,blockquote'));
      const candidates = links.map(a => safeURL(a.getAttribute('href'), base)).filter(u => u?.origin === pageURL.origin && u.pathname === '/post.php' && u.searchParams.get('tid') === tid && ['reply','quote'].includes(u.searchParams.get('action')));
      let url = post ? candidates.find(u => u.searchParams.get('pid') === post.pid && u.searchParams.get('action') === action) || candidates.find(u => u.searchParams.get('pid') === post.pid) : candidates.find(u => !u.searchParams.has('pid') && u.searchParams.get('action') === 'reply');
      if (!url && post) {
        // NGA may create its toolbar lazily. Reuse its button URL template too,
        // without invoking the touch handler that opens an inline editor.
        const page = ngaPageContext(window), template = page.commonui?.postBtn?.d?.[action === 'quote' ? 7 : 8]?.u;
        const nativeArg = doc === document ? page.commonui?.postArg?.data?.[post.index] : null;
        const fields = {fid:nativeArg?.fid ?? page.__CURRENT_FID,tid,pid:post.pid,i:post.index};
        if (typeof template === 'string' && !template.match(/\{([^}]+)\}/g)?.some(key => fields[key.slice(1,-1)] == null)) {
          const candidate = safeURL(template.replace(/\{([^}]+)\}/g, (_, key) => encodeURIComponent(fields[key])), base);
          if (candidate?.origin === pageURL.origin && candidate.pathname === '/post.php' && candidate.searchParams.get('tid') === tid) url = candidate;
        }
      }
      url = url ? new URL(url) : new URL('/post.php', base);
      if (url.searchParams.get('action') !== action) url.searchParams.set('action', action);
      if (url.searchParams.get('tid') !== tid) url.searchParams.set('tid', tid);
      if (!url.searchParams.has('_newui')) url.searchParams.set('_newui', '');
      if (!url.searchParams.has('fid')) {
        const nativeReply = [...doc.querySelectorAll('a[href]')].map(a => safeURL(a.getAttribute('href'),base)).find(u => u?.origin === pageURL.origin && u.pathname === '/post.php' && u.searchParams.get('tid') === tid && u.searchParams.has('fid'));
        const literal = [...doc.scripts].map(s=>s.textContent).join('\n').match(/\b__CURRENT_FID\s*=\s*(-?\d+)/)?.[1];
        const fid = nativeReply?.searchParams.get('fid') || literal || (doc === document ? ngaPageContext(window).__CURRENT_FID : postURL(document, location.href).searchParams.get('fid'));
        if (fid != null) url.searchParams.set('fid', String(fid));
      }
      if (post) { if (post.pid != null && url.searchParams.get('pid') !== post.pid) url.searchParams.set('pid',post.pid); if (!url.searchParams.has('article')) url.searchParams.set('article',post.index); }
      return url;
    }
    function postLink(url, label, cls = '') {
      const a = link(url, label, cls); a.dataset.readscapeNative = 'true'; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
    }
    function parsePosts(doc, base) {
      const output = [], localSeen = new Set(), userData = readNGAUserData(doc, window);
      for (const rawContent of doc.querySelectorAll('.postcontent, [id^="postcontent"]')) {
        const content = normalizeNGAContent(rawContent, base);
        if (!/^postcontent\d+$/.test(content.id) && !content.classList.contains('postcontent')) continue;
        const index = content.id.match(/(\d+)$/)?.[1];
        const row = rawContent.closest('tr') || doc.getElementById(`post1strow${index}`);
        const container = rawContent.closest('[id^="postcontainer"]') || row;
        if (!row || !container) continue;
        const floorLink = [...row.querySelectorAll('a')].find(a => /^#\d+$/.test(a.textContent.trim()));
        const floorAnchor = container.querySelector('a[name^=l]')?.getAttribute('name')?.match(/^l(\d+)$/);
        const floor = floorLink ? Number(floorLink.textContent.trim().slice(1)) : floorAnchor ? Number(floorAnchor[1]) : null;
        const anchor = container.querySelector('a[id^="pid"][id$="Anchor"]');
        const pid = anchor?.id.match(/^pid(\d+)Anchor$/)?.[1] || null;
        const key = pid != null ? `pid:${pid}` : floor != null ? `floor:${floor}` : `index:${index}:${base}`;
        if (localSeen.has(key)) continue; localSeen.add(key);
        const authorLinks = [...row.querySelectorAll(`[id=postauthor${index}], .author`)];
        const author = authorLinks.find(a => a.textContent.trim()) || authorLinks[0];
        const authorURL = author && safeURL(author.getAttribute('href'), base);
        const uid = authorURL?.searchParams.get('uid') || author?.getAttribute('data-uid') || author?.getAttribute('data-user-id') || row.querySelector('[name=uid]')?.textContent.trim() || (doc === document ? ngaPageContext(window).commonui?.postArg?.data?.[index]?.pAid : null) || author?.getAttribute('onclick')?.match(/userClick\([^,]+,\s*['"](\d+)['"]/)?.[1] || null;
        const userID = uid == null ? null : String(uid);
        const profile = userID && userProfiles.normalize(userData.users[userID] || {uid:userID,username:author?.textContent.trim() || `UID ${uid}`}, userData.groups);
        const nativeAvatar = row.querySelector(`[id=posteravatar${index}], img.avatar`);
        if (profile && !profile.avatar) profile.avatar = userProfiles.avatarURL(nativeAvatar?.getAttribute('src'));
        const date = doc.getElementById(`postdate${index}`) || row.querySelector('.postdatec');
        const original = new URL(base); original.hash = pid ? `pid${pid}Anchor` : `l${floor ?? index}`;
        const quotes = [...content.querySelectorAll('.quote, blockquote, .reply-reference')].filter(q => !q.parentElement?.closest('.quote, blockquote, .reply-reference'));
        const refs = quotes.map(q => {
          const a = [...q.querySelectorAll('a[href]')].find(a => {
            const u = safeURL(a.getAttribute('href'), base); return u?.origin === pageURL.origin && u.searchParams.get('tid') === tid && u.searchParams.has('topid');
          });
          const u = a && safeURL(a.getAttribute('href'), base);
          return u ? { pid: u.searchParams.get('topid'), url: u.href, author: q.querySelector('.userlink')?.textContent.trim() || '' } : null;
        }).filter(Boolean);
        output.push({ key, pid, floor, replyURL: postURL(doc, base, {row,pid,index}).href, quoteURL: postURL(doc, base, {row,pid,index}, 'quote').href, author: profile?.username || author?.textContent.trim() || '匿名用户', uid:userID, profile, time: date?.textContent.trim() || '', content, refs, original: original.href, base, native: doc === document ? container : null });
      }
      return output;
    }

    function detectNextPage(doc, page, base) {
      const metadata = [...doc.scripts].map(s => s.textContent).join('\n').match(/var\s+__PAGE\s*=\s*\{0:[^,]+,1:(\d+),2:(\d+),3:(\d+)/);
      if (metadata && Number(metadata[3]) > 0) return page < Math.ceil((Number(metadata[1]) + 1) / Number(metadata[3]));
      const pagers = [...doc.querySelectorAll('#pagebtop, #pagebbtm')];
      // 没有分页信息的响应仍可手动加载；空分页栏是 NGA 单页帖的结构。
      if (!pagers.length) return null;
      return pagers.some(pager => [...pager.querySelectorAll('a[href]')].some(a => {
        const u = safeURL(a.getAttribute('href'), base);
        return u?.origin === pageURL.origin && u.pathname === pageURL.pathname && u.searchParams.get('tid') === tid &&
          (Number(u.searchParams.get('page')) > page || u.searchParams.get('page') === 'e');
      }));
    }

    function updateNative() {
      autoContinue();
      if (typeof isDeletedDoc === 'function' && isDeletedDoc(document)) { navigation.finish(); return; }
      const posts = parsePosts(document, location.href);
      if (!posts.length) return;
      const sig = posts.map(p => `${p.key}|${p.author}|${JSON.stringify(p.profile)}|${p.replyURL}|${p.quoteURL}|${p.time}|${p.content.outerHTML}`).join('\n') +
        [...document.querySelectorAll('#pagebtop, #pagebbtm')].map(el => el.outerHTML).join('');
      if (sig === initialSignature) return; initialSignature = sig;
      const detectedPage = [...document.querySelectorAll('#pagebtop .invert, #pagebbtm .invert')].map(x => Number(x.textContent.replace(/\p{M}/gu, '').trim())).find(x => x > 0);
      const p = detectedPage || (pageURL.searchParams.get('page') === 'e' && posts[0].floor != null ? Math.floor(posts[0].floor / 20) + 1 : nativePage);
      const firstRender = !pages.size;
      if (firstRender) cursor = p;
      nextPages.set(p, detectNextPage(document, p, location.href));
      pages.set(p, posts); rebuildRecords();
      rtitle.textContent = document.querySelector('#postsubject0')?.textContent.trim() || document.title.replace(/\s*NGA玩家社区.*$/, '');
      cachePage(p,posts,nextPages.get(p));
      if (!rbar.querySelector('a')) {
        const board = [...document.querySelectorAll('#m_nav a[href*="thread.php"]')].at(-1);
        const u = board && safeURL(board.getAttribute('href'));
        if (u) rbar.insertBefore(link(u.href, '返回板块', 'pill'), rbar.lastChild);
      }
      renderReader(); setMode(!!prefs.enabled);
      const targetPid = pageURL.hash.match(/pid(\d+)/)?.[1];
      if (firstRender && targetPid) setTimeout(() => focusRecord(`pid:${targetPid}`), 50);
    }

    function rebuildRecords() {
      records.clear(); for (const list of pages.values()) for (const p of list) records.set(p.key, p);
    }

    function cachePage(number, posts, next) {
      if (!postCache) return;
      const generation = postCache.generation;
      const replies = posts.map(p => { const {content,native,...record} = p; return {...record,html:content.outerHTML}; });
      postCache.saveReplyPage(tid,number,replies,{next,title:rtitle.textContent,url:canonical(number).href}).then(async stored => {
        if (!stored || generation !== postCache.generation || !await postCache.getReplyPage(tid,number)) return;
      });
    }
    function restorePage(cached) {
      if (!cached || cached.tid !== tid || !Array.isArray(cached.replies)) return [];
      return cached.replies.map(p => {
        const base = safeURL(p.base);
        if (!base || base.origin !== pageURL.origin || base.searchParams.get('tid') !== tid || typeof p.html !== 'string' || typeof p.author !== 'string' || typeof p.key !== 'string') return null;
        if (!['replyURL','quoteURL','original'].every(key => { const u=safeURL(p[key]); return u?.origin===pageURL.origin && u.searchParams.get('tid')===tid && ['/post.php','/read.php'].includes(u.pathname); })) return null;
        const content = new DOMParser().parseFromString(p.html,'text/html').body.firstElementChild;
        if (!content || !content.matches('.postcontent,[id^=postcontent]')) return null;
        const refs=(Array.isArray(p.refs)?p.refs:[]).filter(ref=>{const u=safeURL(ref.url);return u?.origin===pageURL.origin&&u.searchParams.get('tid')===tid;});
        return {...p,refs,content,native:null};
      }).filter(Boolean);
    }

    // 图片保留原图入口；加载、失败与查看器都在 Shadow DOM 内处理。
    let viewerReturnFocus, viewerItems = [], viewerIndex = 0;
    const viewer = node('dialog', 'image-viewer');
    viewer.setAttribute('aria-label', '图片查看器');
    const viewerBar = node('div', 'viewer-bar'), viewerCount = node('span', 'viewer-count');
    const viewerOriginal = link('', '打开原图 ↗', 'viewer-original');
    viewerOriginal.target = '_blank'; viewerOriginal.rel = 'noopener noreferrer';
    const viewerClose = button('关闭 ×', 'viewer-close', closeViewer);
    viewerBar.append(viewerCount, viewerOriginal, viewerClose);
    const viewerStage = node('div', 'viewer-stage');
    const viewerPrev = button('‹', 'viewer-prev', () => showViewerImage(viewerIndex - 1));
    const viewerNext = button('›', 'viewer-next', () => showViewerImage(viewerIndex + 1));
    viewerPrev.setAttribute('aria-label', '上一张图片'); viewerNext.setAttribute('aria-label', '下一张图片');
    viewer.append(viewerBar, viewerPrev, viewerStage, viewerNext); shadow.append(viewer);
    viewer.addEventListener('click', event => { if (event.target === viewer || event.target === viewerStage) closeViewer(); });
    viewer.addEventListener('close', () => viewerReturnFocus?.isConnected && viewerReturnFocus.focus({ preventScroll: true }));
    viewer.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); showViewerImage(viewerIndex + (event.key === 'ArrowLeft' ? -1 : 1));
      } else if (event.key === 'Escape') { event.preventDefault(); closeViewer(); }
    });
    function closeViewer() {
      if (!viewer.open) return;
      if (typeof viewer.close === 'function') viewer.close(); else viewer.removeAttribute('open');
      viewerStage.replaceChildren();
      if (viewerReturnFocus?.isConnected) viewerReturnFocus.focus({ preventScroll: true });
    }
    function showViewerImage(index) {
      viewerIndex = Math.max(0, Math.min(index, viewerItems.length - 1));
      const item = viewerItems[viewerIndex]; if (!item) return;
      viewerStage.replaceChildren(makeImage(item.href, item.querySelector('img')?.alt || '', null, false));
      viewerCount.textContent = `${viewerIndex + 1} / ${viewerItems.length}`;
      viewerOriginal.href = item.href;
      viewerPrev.disabled = viewerIndex === 0; viewerNext.disabled = viewerIndex === viewerItems.length - 1;
    }
    function openViewer(attachment) {
      viewerReturnFocus = attachment;
      viewerItems = [...(attachment.closest('.note-gallery') || attachment.closest('.comment') || container).querySelectorAll('.attachment')];
      showViewerImage(viewerItems.indexOf(attachment));
      if (typeof viewer.showModal === 'function') viewer.showModal(); else viewer.setAttribute('open', '');
      viewerClose.focus();
    }
    function makeImage(url, alt, source, interactive = true) {
      const frame = node('span', 'reader-image is-loading'), attachment = link(url, '', 'attachment');
      attachment.setAttribute('aria-label', alt || '查看完整图片');
      const img = node('img'); img.alt = alt; img.decoding = 'async'; img.loading = interactive ? 'lazy' : 'eager'; img.referrerPolicy = 'same-origin';
      const width = Number(source?.getAttribute('width')) || Number(source?.getAttribute('data-nw')) || source?.naturalWidth;
      const height = Number(source?.getAttribute('height')) || Number(source?.getAttribute('data-nh')) || source?.naturalHeight;
      if (width > 0 && height > 0) {
        img.width = width; img.height = height;
        frame.style.setProperty('--image-ratio', `${width} / ${height}`);
        frame.dataset.ratio = `${width} / ${height}`;
      }
      const state = node('span', 'image-state', '图片加载中…'); state.setAttribute('role', 'status');
      const retry = button('重新加载', 'image-retry', () => {
        frame.className = 'reader-image is-loading'; state.textContent = '图片加载中…'; retry.hidden = true;
        img.src = url;
      }); retry.hidden = true;
      const loaded = () => {
        if (!img.naturalWidth) return;
        frame.className = 'reader-image is-loaded'; state.textContent = ''; retry.hidden = true;
        frame.style.setProperty('--image-ratio', `${img.naturalWidth} / ${img.naturalHeight}`);
        frame.dataset.ratio = `${img.naturalWidth} / ${img.naturalHeight}`;
      };
      img.addEventListener('load', loaded);
      img.addEventListener('error', () => {
        frame.className = 'reader-image is-error'; state.textContent = '图片加载失败'; retry.hidden = false;
      });
      attachment.append(img, state); frame.append(attachment, retry);
      attachment.addEventListener('click', event => {
        if (interactive && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
          event.preventDefault(); openViewer(attachment);
        } else if (!interactive && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
          event.preventDefault(); closeViewer();
        }
      });
      img.src = url;
      if (img.complete && img.naturalWidth) loaded();
      return frame;
    }
    function makeGallery(images) {
      const gallery = node('section', 'note-gallery'), track = node('div', 'gallery-track');
      gallery.setAttribute('aria-label', '首楼图集'); track.tabIndex = 0; track.setAttribute('aria-label', '左右滑动浏览图片');
      const count = node('span', 'gallery-count', `1 / ${images.length}`), dots = node('div', 'gallery-dots');
      let current = 0;
      const select = index => {
        current = Math.max(0, Math.min(index, images.length - 1));
        track.scrollTo({ left: current * track.clientWidth, behavior: 'smooth' });
      };
      const prev = button('‹', 'gallery-prev', () => select(current - 1));
      const next = button('›', 'gallery-next', () => select(current + 1));
      prev.setAttribute('aria-label', '上一张'); next.setAttribute('aria-label', '下一张');
      const update = () => {
        if (track.clientWidth) current = Math.round(track.scrollLeft / track.clientWidth);
        count.textContent = `${current + 1} / ${images.length}`;
        [...dots.children].forEach((dot, i) => dot.setAttribute('aria-pressed', String(i === current)));
        prev.disabled = current === 0; next.disabled = current === images.length - 1;
      };
      images.forEach((image, i) => {
        const slide = node('div', 'gallery-slide'); slide.append(image); track.append(slide);
        const img = image.querySelector('img'); img.loading = i === 0 ? 'eager' : 'lazy';
        if (i === 0) img.setAttribute('fetchpriority', 'high');
        const dot = button('', 'gallery-dot', () => select(i)); dot.setAttribute('aria-label', `查看第 ${i + 1} 张`); dots.append(dot);
      });
      track.addEventListener('scroll', update, { passive: true });
      track.addEventListener('keydown', event => {
        if (event.target === track && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
          event.preventDefault(); select(current + (event.key === 'ArrowLeft' ? -1 : 1));
        }
      });
      count.hidden = dots.hidden = prev.hidden = next.hidden = images.length < 2;
      gallery.append(track, count, prev, next, dots); update(); return gallery;
    }

    function sanitized(source, base) {
      const fragment = document.createDocumentFragment();
      const allowed = new Set(['P','DIV','SPAN','BR','B','STRONG','EM','I','U','S','DEL','PRE','CODE','UL','OL','LI','TABLE','THEAD','TBODY','TR','TD','TH','H1','H2','H3','H4','HR','DETAILS','SUMMARY','FONT']);
      const copy = (child, dest) => {
        if (child.nodeType === 3) { dest.append(document.createTextNode(child.textContent)); return; }
        if (child.nodeType !== 1 || ['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','SVG'].includes(child.tagName)) return;
        // NGA 注入的外链提示与装饰括号不是帖子正文；移除后保留实际链接。
        if (child.matches('.urltip, .apd')) return;
        if (child.matches('.reply-reference')) {
          const target = [...child.querySelectorAll('a[href]')].map(a => safeURL(a.getAttribute('href'),base)).find(u => u?.origin === pageURL.origin && u.searchParams.get('tid') === tid && u.searchParams.has('topid'));
          if (target) { dest.append(button(child.textContent.trim(), 'context reply-rel', () => showContext(target))); return; }
        }
        if (child.matches('.quote, blockquote')) {
          const detail = node('details', 'quoted'), title = node('summary');
          const body = node('div', 'quoted-body');
          for (const c of child.childNodes) copy(c, body);
          const raw = body.textContent.replace(/\s+/g, ' ').replace(/\(undefined\)/g, '').trim();
          const excerpt = raw.replace(/^[+R\s]*by\s*/i, '');
          title.textContent = `引用 · ${excerpt.slice(0, 85)}${excerpt.length > 85 ? '…' : ''}`;
          const target = [...child.querySelectorAll('a[href]')].map(a => safeURL(a.getAttribute('href'), base)).find(u => u?.origin === pageURL.origin && u.searchParams.get('tid') === tid && u.searchParams.has('topid'));
          detail.append(title, body);
          if (target) detail.append(button('查看原楼 ↗', 'context', () => showContext(target)));
          dest.append(detail); return;
        }
        if (child.tagName === 'IMG') {
          if (child.getAttribute('style')?.includes('display:none') || child.getAttribute('style')?.includes('display: none')) return;
          const raw = child.getAttribute('data-src') || child.getAttribute('data-original') || child.getAttribute('src');
          if (!raw) return;
          const u = safeURL(raw, base);
          if (!u) return;
          const alt = child.getAttribute('alt') || '';
          if (/smile|emotion/i.test(u.href) || /smile/.test(child.className)) {
            const img = node('img', 'emoji'); img.src = u.href; img.alt = alt; img.loading = 'lazy'; img.referrerPolicy = 'same-origin'; dest.append(img);
          } else dest.append(makeImage(u.href, alt, child));
          return;
        }
        if (child.tagName === 'A') {
          if (child.querySelector('img')) { for (const c of child.childNodes) copy(c, dest); return; }
          const href = child.getAttribute('href');
          const u = href?.trim() ? safeURL(href, base) : null;
          if (!u) { if (!/^[+R]$/.test(child.textContent.trim())) for (const c of child.childNodes) copy(c, dest); return; }
          if (child.classList.contains('pid-reference') && !child.closest('.quote,blockquote,.reply-reference') && u.origin === pageURL.origin && u.searchParams.get('tid') === tid && u.searchParams.has('topid')) {
            dest.append(button('查看原楼 ↗', 'context', () => showContext(u))); return;
          }
          const a = link(u.href, '', 'content-link'); a.rel = 'noopener noreferrer';
          a.title = u.href;
          if (u.origin !== pageURL.origin) {
            a.classList.add('external-link'); a.target = '_blank';
          } else if (child.getAttribute('target') === '_blank') a.target = '_blank';
          for (const c of child.childNodes) copy(c, a);
          if (!a.textContent.trim()) a.textContent = u.href;
          dest.append(a); return;
        }
        const tag = allowed.has(child.tagName) ? (child.tagName === 'FONT' ? 'span' : child.tagName.toLowerCase()) : 'span';
        const el = node(tag); if (child.tagName === 'DETAILS' && child.hasAttribute('open')) el.open = true;
        for (const c of child.childNodes) copy(c, el); dest.append(el);
      };
      for (const child of source.childNodes) copy(child, fragment);
      return fragment;
    }

    function syncCommentActions(card, p, authenticated) {
      const actions = card.querySelector('.comment-actions');
      if (!authenticated) { actions.querySelectorAll('a').forEach(a => a.remove()); return; }
      if (!actions.querySelector('.floor-reply')) actions.append(postLink(p.replyURL, '回复', 'floor-reply'), postLink(p.quoteURL, '引用', 'floor-quote'));
    }

    function makeComment(p, parent) {
      const op = p.floor === 0;
      const signature = [p.author, p.uid, JSON.stringify(p.profile), p.replyURL, p.quoteURL, p.time, p.content.outerHTML, p.original, op ? rtitle.textContent : '', parent?.key || '', parent?.author || ''].join('|');
      const existing = previousCards.get(p.key);
      if (existing?.signature === signature) { cards.set(p.key, existing.card); return existing.card; }
      const card = node('article', `comment${op ? ' op' : ''}`); card.dataset.key = p.key; card.style.setProperty('--bg', color(p.pid || String(p.floor || 0)));
      const head = node('header', 'comment-head'), identity = node('div', 'reader-identity');
      const name = button(p.author, 'reader-author user-trigger', () => userProfiles.show(p, name)); if (op) name.append(node('span', 'op-label', '楼主'));
      identity.append(name, node('div', 'comment-date', p.time));
      const floor = link(p.original, op ? '首楼' : `#${p.floor ?? '?'}`, 'floor');
      floor.title = '在原站查看此楼'; floor.setAttribute('aria-label', `${op ? '首楼' : `第 ${p.floor ?? '?'} 楼`}，在原站查看`);
      const avatar = button(p.author.replace(/^UID:/, '').slice(0, 1) || 'N', 'reader-avatar user-trigger', () => userProfiles.show(p, avatar));
      userProfiles.decorate(avatar, p, true);
      head.append(avatar, identity, floor);
      const body = node('div', 'comment-content'); body.append(sanitized(p.content, p.base));
      const actions = node('div', 'comment-actions');
      actions.append(node('span', 'action-date', p.time));
      card.append(head);
      if (parent) card.append(node('div', 'reply-rel', `回复 #${parent.floor ?? '?'} · ${parent.author}`));
      if (op) {
        const images = [...body.querySelectorAll('.reader-image')].filter(image => !image.closest('.quoted, table, details'));
        const firstFrame = [...body.querySelectorAll('.reader-image')].find(image => !image.closest('.quoted'));
        const firstImage = firstFrame?.querySelector('.attachment');
        if (firstImage) {
          // 记下封面比例，列表可在图片加载前预占位，滚动时卡片高度不跳、点击命中稳定。
          const sent = firstFrame.dataset.ratio || '';
          const [coverW, coverH] = sent.split(' / ').map(Number);
          postCache?.saveCover(tid, firstImage.href, { title: rtitle.textContent, url: pageURL.href, ...(coverW > 0 && coverH > 0 ? { coverW, coverH } : {}) });
          firstFrame.querySelector('img')?.addEventListener('load', () => {
            const img = firstFrame.querySelector('img'), ratio = `${img.naturalWidth} / ${img.naturalHeight}`;
            if (img.naturalWidth > 0 && ratio !== sent) postCache?.saveCover(tid, firstImage.href, { coverW: img.naturalWidth, coverH: img.naturalHeight });
          }, { once: true });
        }
        if (images.length) { card.classList.add('has-gallery'); card.append(makeGallery(images)); }
        const copy = node('div', 'note-copy'); copy.append(node('h1', 'note-title', rtitle.textContent), body);
        card.append(copy, actions);
      } else card.append(body, actions);
      card.readerPost = p; syncCommentActions(card, p, !!currentAccount());
      card.readerSignature = signature; cards.set(p.key, card); return card;
    }

    // Keep unchanged nodes attached: clearing the stream can clamp the browser's
    // scroll position and interrupt mobile scrolling even if it is restored later.
    function reconcileChildren(parent, children) {
      let current = parent.firstChild;
      for (const child of children) {
        if (child !== current) parent.insertBefore(child, current);
        current = child.nextSibling;
      }
      while (current) { const next = current.nextSibling; current.remove(); current = next; }
    }

    function renderReader() {
      const scroll = getReadingScroll();
      const galleryScrolls = [...stream.querySelectorAll('.gallery-track')].map(track => [track, track.scrollLeft]);
      previousCards = new Map([...cards].map(([key, card]) => [key, { card, signature: card.readerSignature }]));
      const sections = new Map([...stream.children].map(section => [Number(section.dataset.page), section]));
      const nextSections = [];
      cards.clear();
      const hasOp = [...records.values()].some(p => p.floor === 0);
      rhead.hidden = hasOp;
      // 同页关系图仅接受一个明确引用，且只能指向较早的非首楼，避免误合并和循环。
      for (const [number, posts] of [...pages].sort((a, b) => a[0] - b[0])) {
        const section = sections.get(number) || node('section', 'reader-page'); section.dataset.page = number;
        const sectionChildren = [], threads = new Map([...section.children].filter(child => child.classList.contains('thread')).map(thread => [thread.dataset.parent, thread]));
        if (!posts.some(p => p.floor === 0)) {
          const heading = [...section.children].find(child => child.classList.contains('page-heading')) || node('div', 'page-heading');
          const label = `第 ${number} 页 · ${posts.length} 个楼层`;
          if (heading.textContent !== label) heading.textContent = label;
          sectionChildren.push(heading);
        }
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
          sectionChildren.push(makeComment(p));
          const replies = descendants(p).sort((a, b) => a.floor - b.floor);
          if (replies.length) {
            const thread = threads.get(p.key) || node('details', 'thread'); thread.dataset.parent = p.key;
            const summary = [...thread.children].find(child => child.tagName === 'SUMMARY') || node('summary');
            const label = `展开 ${replies.length} 条关联回复`;
            if (summary.textContent !== label) summary.textContent = label;
            reconcileChildren(thread, [summary, ...replies.map(reply => makeComment(reply, parents.get(reply.key)))]);
            sectionChildren.push(thread);
          }
        }
        reconcileChildren(section, sectionChildren);
        nextSections.push(section);
      }
      reconcileChildren(stream, nextSections);
      rsub.textContent = `已加载 ${pages.size} 页 · ${records.size} 个楼层 · 引用默认折叠`;
      dockCount.textContent = `评论 ${[...records.values()].filter(p => p.floor !== 0).length}`;
      let last = cursor;
      while (pages.has(last + 1)) last++;
      const atEnd = ended || nextPages.get(last) === false;
      load.hidden = atEnd; endMarker.hidden = !atEnd;
      load.disabled = busy || atEnd; load.textContent = busy ? '正在加载…' : '加载下一页';
      // 浏览器会在节点脱离文档时重置横向滚动，接回后恢复当前图片。
      for (const [track, left] of galleryScrolls) if (track.isConnected) track.scrollLeft = left;
      if (getReadingScroll() !== scroll) setReadingScroll(scroll);
    }

    function focusRecord(key) {
      const card = cards.get(key); if (!card) return false;
      let parent = card.parentElement; while (parent && parent !== container) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
      card.scrollIntoView({ block: 'center', behavior: 'smooth' }); card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1700); return true;
    }

    async function showContext(u) {
      const key = `pid:${u.searchParams.get('topid')}`;
      if (focusRecord(key)) return;
      if (busy) { status.textContent = '正在加载页面，请稍后再查看原楼。'; return; }
      const page = Number(u.searchParams.get('page'));
      if (Number.isInteger(page) && page > 0) {
        await loadPage(page);
        if (focusRecord(key)) return;
      }
      // NGA's older references may omit their page. Search at most the first 500 replies.
      if (!Number.isInteger(page) || page < 1 || page <= 26) {
        for (let number = 1; number <= 26; number++) {
          await loadPage(number);
          if (focusRecord(key)) return;
          if (nextPages.get(number) === false || !pages.has(number)) break;
        }
      }
      status.replaceChildren(node('span', '', '原楼暂未解析到，可在原站查看： '), link(u.href, '打开原楼'));
    }

    async function loadPage(number, advance = false) {
      if (pages.has(number) || busy || !Number.isInteger(number) || number < 1) return;
      busy = true; renderReader(); status.textContent = `正在读取第 ${number} 页…`;
      const u = canonical(number), controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
      const generation = postCache?.generation;
      try {
        const cached = await postCache?.getReplyPage(tid,number), restored = restorePage(cached).filter(p=>!records.has(p.key));
        if (restored.length && generation === postCache?.generation) {
          nextPages.set(number,cached.next); pages.set(number,restored); rebuildRecords(); postCache.visit({tid});
          status.textContent = `第 ${number} 页来自本地缓存`; return;
        }
        const { doc, responseURL } = await ngaApi.fetchDoc(u.href, { signal: controller.signal });
        const finalURL = safeURL(responseURL || u.href);
        if (!finalURL || finalURL.origin !== pageURL.origin || finalURL.searchParams.get('tid') !== tid) throw new Error('原站返回了其他页面');
        const all = parsePosts(doc, u.href), fresh = all.filter(p => !records.has(p.key));
        if (!all.length) throw new Error('需要原站跳转、登录，或页面结构不支持');
        if (!fresh.length) { if (advance) ended = true; status.textContent = '原站未返回新的楼层，已停止重复加载。'; return; }
        nextPages.set(number, detectNextPage(doc, number, u.href));
        pages.set(number, fresh); rebuildRecords(); status.textContent = `已加载第 ${number} 页`;
        if (generation === postCache?.generation) cachePage(number,all,nextPages.get(number));
      } catch (error) {
        status.replaceChildren(node('span', '', `${error.name === 'AbortError' ? '加载超时' : error.message}。 `), link(u.href, `直接打开第 ${number} 页`));
      } finally { clearTimeout(timeout); busy = false; renderReader(); }
    }

    let nativeObserver;
    const initialPosts = options.initialPosts || (options.initialDoc ? parsePosts(options.initialDoc, targetURL.href) : null);
    if (initialPosts && initialPosts.length) {
      cursor = nativePage;
      pages.set(nativePage, initialPosts);
      rebuildRecords();
      rtitle.textContent = options.initialDoc?.querySelector?.('#postsubject0')?.textContent.trim() || options.initialDoc?.title?.replace(/\s*NGA玩家社区.*$/, '') || rtitle.textContent;
      nextPages.set(nativePage, detectNextPage(options.initialDoc || document, nativePage, targetURL.href));
      renderReader();
      setMode(!!prefs.enabled);
    } else {
      updateNative();
      const restoreGeneration = postCache?.generation;
      postCache?.getReplyPage(tid,nativePage).then(cached => {
        if (pages.size || coverDisposed || restoreGeneration !== postCache.generation) return;
        const restored = restorePage(cached); if (!restored.length) return;
        cursor = nativePage; pages.set(nativePage,restored); nextPages.set(nativePage,cached.next); rtitle.textContent = cached.title || rtitle.textContent;
        rebuildRecords(); renderReader(); setMode(!!prefs.enabled); status.textContent = '正在阅读本地缓存';
      });
      nativeObserver = new MutationObserver(() => { clearTimeout(scanTimer); scanTimer = setTimeout(updateNative, 250); });
      nativeObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    const userSignature = () => {
      const table = readNGAUserData(options.initialDoc || document, window);
      return JSON.stringify([Object.entries(table.users).map(([uid,u]) => [uid,u.username,u.avatar,u.regdate,u.memberid,u.groupid,u.rvrc,u.money,u.postnum]),table.groups]);
    };
    let lastUsers = userSignature();
    const userRefresh = window.setInterval(() => {
      if (!options.initialPosts) {
        const signature = userSignature();
        if (signature !== lastUsers) { lastUsers = signature; updateNative(); }
      }
    }, 1200);
    window.addEventListener('pagehide', () => { window.clearInterval(userRefresh); nativeObserver?.disconnect?.(); clearTimeout(scanTimer); clearTimeout(gateTimer); });

    return {
      destroy() {
        closeViewer();
        if (scanTimer) clearTimeout(scanTimer);
        nativeObserver?.disconnect?.();
        window.clearInterval(userRefresh);
        modeToggle = prevModeToggle;
        settingsRefresh = prevSettingsRefresh;
        accountChanged = prevAccountChanged;
      },
      title: rtitle.textContent
    };
  }
