const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('node:fs');
const bundle = fs.readFileSync(__dirname + '/../dist/readscape-nga.user.js', 'utf8');

const tick = () => new Promise(resolve => setTimeout(resolve, 80));

const postRow = (floor, pid, author, body, title = '') => `
  <table>
    <tr id="post1strow${floor}">
      <td><a href="#l${floor}">#${floor}</a><a id="postauthor${floor}" class="author" href="/nuke.php?uid=${floor}">${author}</a></td>
      <td id="postcontainer${floor}">
        <a id="pid${pid}Anchor"></a><a name="l${floor}"></a>
        <div id="postInfo${floor}"><span id="postdate${floor}">2026-10-03 12:00</span></div>
        <h3 id="postsubject${floor}">${floor === 0 ? title : ''}</h3>
        <span id="postcontent${floor}" class="postcontent ubbcode">${body}</span>
      </td>
    </tr>
  </table>
`;

const postDetailFixture = (tid, title = '测试帖子标题', content = '这是帖子正文内容') => `
<!DOCTYPE html>
<html>
<head><title>${title} NGA玩家社区</title></head>
<body>
  ${postRow(0, 0, '测试作者', content, title)}
  ${postRow(1, 1001, '回复作者', '这是一楼回复')}
</body>
</html>
`;

function createSPAPage({ fetcher } = {}) {
  const listHTML = `
  <table id="topicrows">
    <tr class="topicrow">
      <td class="c1">18</td>
      <td class="c2"><a class="topic" href="/read.php?tid=100">帖子100</a></td>
      <td class="c3"><a class="author">作者1</a></td>
    </tr>
    <tr class="topicrow">
      <td class="c1">5</td>
      <td class="c2"><a class="topic" href="/read.php?tid=200">帖子200</a></td>
      <td class="c3"><a class="author">作者2</a></td>
    </tr>
  </table>
  `;

  const d = new JSDOM('<head></head><body>' + listHTML + '</body>', {
    url: 'https://bbs.nga.cn/thread.php?fid=1',
    runScripts: 'dangerously',
    virtualConsole: new VirtualConsole()
  });
  const w = d.window;
  w.TextDecoder = TextDecoder;
  w.TextEncoder = TextEncoder;

  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (fetcher) {
    w.fetch = fetcher;
  }
  w.eval(bundle);
  const host = w.document.getElementById('nga-cards-host');
  const root = host.shadowRoot;
  return { d, w, root };
}

test('SPA reader loads post via background fetch and mounts in-page without iframe', async () => {
  let fetchedURL = null;
  const { d, w, root } = createSPAPage({
    fetcher: async (url) => {
      fetchedURL = String(url);
      return {
        ok: true,
        text: async () => postDetailFixture('100', '精选攻略：从入门到精通', '详细的正文内容测试')
      };
    }
  });

  try {
    const listApp = root.querySelector('.app:not(.reader)');
    assert.equal(listApp.style.display, '');
    assert.equal(!!listApp.inert, false);

    const card = root.querySelector('[data-tid="100"]');
    assert(card, 'Card 100 should exist');
    const cover = card.querySelector('.cover');
    assert(cover, 'Cover should exist');

    // Click card cover
    cover.click();
    await tick();

    // Verify background fetch was invoked
    assert.match(fetchedURL, /tid=100/);

    // Verify NO iframe was created
    assert.equal(w.document.querySelector('iframe[data-readscape-reader]'), null);

    // Verify listApp was hidden and made inert
    assert.equal(listApp.style.display, 'none');
    assert.equal(listApp.inert, true);

    // Verify readerApp is mounted and visible
    const readerApp = root.querySelector('.app.reader');
    assert(readerApp, 'Reader app container should be mounted');
    assert.equal(readerApp.style.display, '');
    assert.equal(readerApp.hidden, false);

    // Verify reader content
    assert.match(readerApp.textContent, /精选攻略：从入门到精通/);
    assert.match(readerApp.textContent, /详细的正文内容测试/);
    assert.match(readerApp.textContent, /这是一楼回复/);

    // Verify document.title and URL updated
    assert.match(w.document.title, /精选攻略/);
    assert.match(w.location.href, /tid=100/);

    // Now test navigating back via popstate
    w.history.back();
    // Dispatch popstate event as JSDOM does not auto-dispatch on history.back
    w.dispatchEvent(new w.PopStateEvent('popstate', { state: null }));
    await tick();

    // Verify readerApp is hidden/cleared
    assert.equal(readerApp.hidden, true);
    assert.equal(readerApp.style.display, 'none');

    // Verify listApp is restored
    assert.equal(listApp.style.display, '');
    assert.equal(listApp.inert, false);
  } finally {
    d.window.close();
  }
});

test('SPA reader handles deleted post by removing card and showing notice', async () => {
  const { d, w, root } = createSPAPage({
    fetcher: async (url) => {
      return {
        ok: true,
        text: async () => `<html><head><title>提示信息</title></head><body>ERROR: 62 (帖子被删除)</body></html>`
      };
    }
  });

  try {
    const card = root.querySelector('[data-tid="100"]');
    assert(card, 'Card 100 should exist initially');

    card.querySelector('.cover').click();
    await tick();

    // Card should be removed
    assert.equal(root.querySelector('[data-tid="100"]'), null);

    // Reader should not be opened
    const readerApp = root.querySelector('.app.reader');
    assert(!readerApp || readerApp.hidden);
  } finally {
    d.window.close();
  }
});

test('SPA reader falls back gracefully when fetch is unavailable', async () => {
  // Page without fetcher (w.fetch undefined)
  const { d, w, root } = createSPAPage();

  try {
    const card = root.querySelector('[data-tid="100"]');
    card.querySelector('.cover').click();
    await tick();

    // Without fetch, it falls back to the iframe loader
    const frame = w.document.querySelector('iframe[data-readscape-reader]');
    assert(frame, 'Should fall back to iframe when fetch is not available');
    assert.match(frame.src, /tid=100/);
  } finally {
    d.window.close();
  }
});
