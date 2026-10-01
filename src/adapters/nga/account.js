function ngaPageContext(context) {
  return context === globalThis.window && typeof unsafeWindow !== 'undefined' ? unsafeWindow : context;
}

// NGA's CURRENT fields identify the session; userInfo contains every poster on the page.
function readCurrentAccount(context) {
  const { document } = context;
  const scripts = [...document.scripts].filter(script => !script.src);
  const page = ngaPageContext(context);
  let uid = page.__CURRENT_UID, username = page.__CURRENT_UNAME;
  const positiveUID = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? String(Number(value)) : null;
  function stringLiteral(raw) {
    return raw.slice(1, -1).replace(/\\(?:u([\da-f]{4})|x([\da-f]{2})|([\s\S]))/gi, (_, unicode, hex, escaped) => {
      if (unicode || hex) return String.fromCharCode(parseInt(unicode || hex, 16));
      return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '\n': '' })[escaped] ?? escaped;
    });
  }
  // Tampermonkey's isolated world may not expose page globals. Read the known
  // literal assignments from the original response instead of evaluating scripts.
  if (uid === undefined) for (const script of scripts) {
    const assignment = script.textContent.match(/\b__CURRENT_UID\s*=\s*(?:parseInt\(\s*(['"])(\d*)\1\s*,\s*10\s*\)|(\d+))/);
    if (assignment) { uid = assignment[2] ?? assignment[3]; break; }
  }
  uid = positiveUID(uid);
  if (!uid) return null;
  if (username === undefined) for (const script of scripts) {
    const assignment = script.textContent.match(/\b__CURRENT_UNAME\s*=\s*('(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*")/);
    if (assignment) { username = stringLiteral(assignment[1]); break; }
  }
  if (!username) username = page.commonui?.userInfo?.users?.[uid]?.username;
  if (!username) username = readNGAUserData(document, context).users[uid]?.username;
  return { uid, username: typeof username === 'string' || Object.prototype.toString.call(username) === '[object String]' ? String(username) : '当前用户' };
}

// Extract JSON data only; fetched NGA scripts are never executed.
function readNGAJSON(source, start) {
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try { return JSON.parse(source.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}
const ngaUserTables = new WeakMap();
function readNGAUserData(document, context) {
  const sources = [...document.scripts].filter(s => !s.src).map(s => s.textContent).filter(s => /userInfo\.setAll|__UCPUSER/.test(s));
  let cached = ngaUserTables.get(document);
  if (!cached || sources.length !== cached.sources.length || sources.some((source, i) => source !== cached.sources[i])) {
    const users = {}, groups = {};
    for (const source of sources) {
      for (const match of source.matchAll(/(?:commonui\.userInfo\.setAll\s*\(\s*|__UCPUSER\s*=\s*)\{/g)) {
        const data = readNGAJSON(source, match.index + match[0].length - 1);
        if (!data) continue;
        if (match[0].includes('__UCPUSER')) { if (data.uid) users[String(data.uid)] = data; }
        else { Object.assign(groups, data.__GROUPS); for (const [uid, user] of Object.entries(data)) if (/^\d+$/.test(uid)) users[uid] = user; }
      }
    }
    cached = { sources, users, groups }; ngaUserTables.set(document, cached);
  }
  const live = document === context?.document ? ngaPageContext(context).commonui?.userInfo : null;
  return { users: { ...cached.users, ...live?.users }, groups: { ...cached.groups, ...live?.groups } };
}
