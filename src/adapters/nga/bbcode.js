  // Convert NGA's inert response DOM without running its inline scripts.
  function normalizeNGAContent(source, base) {
    const root = source.cloneNode(false), stack = [{ el: root }];
    const current = () => stack.at(-1).el;
    const finish = entry => {
      if (entry.tag === 'img') {
        let raw = entry.el.textContent.trim();
        if (raw.startsWith('./mon_')) raw = `https://img.nga.cn/attachments/${raw.slice(2)}`;
        const u = safeURL(raw, base);
        if (u) { const img = node('img'); img.src = u.href; entry.el.replaceWith(img); }
      } else if (entry.tag === 'url') {
        const u = safeURL(entry.arg || entry.el.textContent.trim(), base);
        if (u) entry.el.setAttribute('href', u.href);
      }
    };
    const text = value => {
      const tokens = /\[(\/?)([a-z]+)(?:([=:])([^\]]*))?\]/gi;
      let offset = 0, match;
      while ((match = tokens.exec(value))) {
        current().append(document.createTextNode(value.slice(offset, match.index))); offset = tokens.lastIndex;
        const [literal, closing, name, separator, arg = ''] = match, tag = name.toLowerCase();
        const code = stack.findLastIndex(e => e.tag === 'code' || e.tag === 'pre');
        if (code > 0 && !(closing && stack[code].tag === tag)) { current().append(document.createTextNode(literal)); continue; }
        if (closing) {
          const index = stack.findLastIndex(e => e.tag === tag);
          if (index > 0) { while (stack.length > index) finish(stack.pop()); }
          else current().append(document.createTextNode(literal));
          continue;
        }
        let el;
        if (tag === 's' && separator === ':') {
          const parts = arg.split(':'), group = parts.length > 1 ? parts.shift() : '0', smile = parts.join(':');
          const file = ngaPageContext(window).ubbcode?.smiles?.[group]?.[smile];
          if (typeof file === 'string' && /^[\w.-]+$/.test(file)) {
            el = node('img', 'smile'); el.src = `https://img4.nga.cn/ngabbs/post/smile/${file}`; el.alt = literal;
          } else el = node('span', 'emoji', ({goodjob:'👍',哭笑:'😂',咦:'🤔',晕:'😵',赞同:'👍',满足:'😊'})[smile] || '🙂');
          current().append(el); continue;
        }
        const tags = {b:'b',i:'i',u:'u',s:'s',del:'del',code:'code',pre:'pre',quote:'blockquote',collapse:'details',url:'a',img:'span',uid:'a',pid:'a',size:'span',color:'span',font:'span',align:'div',list:'ul',li:'li'};
        if (!tags[tag]) { current().append(document.createTextNode(literal)); continue; }
        el = node(tags[tag]);
        if (tag === 'quote') el.className = 'quote';
        if (tag === 'collapse') el.append(node('summary', '', arg || '展开内容'));
        if (tag === 'uid' && /^\d+$/.test(arg)) { el.className = 'userlink'; el.setAttribute('href', new URL(`/nuke.php?func=ucp&uid=${arg}`,base).href); }
        if (tag === 'pid' && /^\d+,\d+(?:,\d+)?$/.test(arg)) {
          const [pid,tid,page] = arg.split(','), u = new URL('/read.php',base);
          u.searchParams.set('tid',tid); u.searchParams.set('topid',pid); if (page) u.searchParams.set('page',page);
          el.className = 'pid-reference'; el.setAttribute('href',u.href);
        }
        current().append(el); stack.push({el,tag,arg});
      }
      current().append(document.createTextNode(value.slice(offset)));
    };
    const walk = child => {
      if (child.nodeType === 3) { text(child.textContent); return; }
      if (child.nodeType !== 1 || child.matches('script,style,iframe,object,embed')) return;
      const el = child.cloneNode(false); current().append(el);
      if (['BR','IMG','HR'].includes(child.tagName)) return;
      const entry = {el, tag: ['CODE','PRE'].includes(child.tagName) ? child.tagName.toLowerCase() : undefined}; stack.push(entry);
      for (const nested of child.childNodes) walk(nested);
      const index = stack.indexOf(entry);
      if (index >= 0) while (stack.length > index) finish(stack.pop());
    };
    for (const child of source.childNodes) walk(child);
    while (stack.length > 1) finish(stack.pop());
    for (const header of root.querySelectorAll('b,strong')) {
      if (/^Reply to\b/i.test(header.textContent.trim()) && header.querySelector('.pid-reference')) header.classList.add('reply-reference');
    }
    return root;
  }
