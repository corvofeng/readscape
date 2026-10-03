const {test} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM, VirtualConsole} = require('jsdom');
const fs = require('node:fs');
const bundle = fs.readFileSync(__dirname + '/../dist/readscape-nga.user.js', 'utf8');

const listFixture = '<table id="topicrows"><tr><td class="c1">12</td><td class="c2"><a class="topic" href="/read.php?tid=1">测试标题</a></td><td class="c3"><a class="author">作者</a></td></tr></table>';

function createDesktopPage(path = '/thread.php?fid=-7', html = listFixture) {
  const d = new JSDOM('<head></head><body>' + html + '</body>', {
    url: 'https://bbs.nga.cn' + path,
    runScripts: 'dangerously',
    virtualConsole: new VirtualConsole()
  });
  const w = d.window;
  let change;
  const media = { matches: false, addEventListener: (type, fn) => change = fn, removeEventListener: () => {} };
  w.matchMedia = () => media;
  w.eval(bundle);
  return { d, w, root: w.document.querySelector('#nga-cards-host').shadowRoot, media, resize: () => change() };
}

test('desktop list navigates with arrow keys, page keys, space and home/end', () => {
  const { d, w, root } = createDesktopPage();
  const app = root.querySelector('.app');
  assert.equal(app.tabIndex, -1, 'app container should have tabIndex -1');

  // Initial scroll is 0
  assert.equal(app.scrollTop, 0);

  // ArrowDown scrolls down by 80px
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.equal(app.scrollTop, 80);

  // ArrowDown again
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.equal(app.scrollTop, 160);

  // ArrowUp scrolls up by 80px
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  assert.equal(app.scrollTop, 80);

  // PageDown scrolls down
  Object.defineProperty(app, 'clientHeight', { value: 800, configurable: true });
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }));
  assert.equal(app.scrollTop, 80 + (800 - 60));

  // PageUp scrolls up
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'PageUp', bubbles: true, cancelable: true }));
  assert.equal(app.scrollTop, 80);

  // Space scrolls down
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
  assert.equal(app.scrollTop, 80 + (800 - 60));

  // Shift + Space scrolls up
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: ' ', shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(app.scrollTop, 80);

  // End scrolls to bottom
  Object.defineProperty(app, 'scrollHeight', { value: 5000, configurable: true });
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  assert.equal(app.scrollTop, 5000);

  // Home scrolls to top
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
  assert.equal(app.scrollTop, 0);

  // Cmd+ArrowDown / Cmd+ArrowUp on Mac
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', metaKey: true, bubbles: true, cancelable: true }));
  assert.equal(app.scrollTop, 5000);
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowUp', metaKey: true, bubbles: true, cancelable: true }));
  assert.equal(app.scrollTop, 0);

  d.window.close();
});

test('desktop list does not intercept arrow keys when typing in input or when dialog is open', () => {
  const { d, w, root } = createDesktopPage();
  const app = root.querySelector('.app');
  const searchInput = root.querySelector('.search input');
  assert(searchInput, 'search input exists');

  app.scrollTop = 100;
  // Key event originating from search input
  searchInput.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.equal(app.scrollTop, 100, 'scrollTop should not change when typing in search input');

  searchInput.dispatchEvent(new w.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
  assert.equal(app.scrollTop, 100, 'Space should not scroll when typing in search input');

  // Key event when notice dialog is open
  const dialog = root.querySelector('.notice-dialog') || w.document.createElement('dialog');
  dialog.open = true;
  if (!dialog.isConnected) root.append(dialog);

  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.equal(app.scrollTop, 100, 'scrollTop should not change when dialog is open');

  d.window.close();
});

test('desktop reader supports up/down keyboard scrolling and restores list keyboard scrolling after returning', async () => {
  const { d, w, root } = createDesktopPage();
  const listApp = root.querySelector('.app');
  const card = root.querySelector('.cover');
  let poll;
  w.setInterval = fn => { poll = fn; return 1; };
  w.clearInterval = () => {};

  listApp.scrollTop = 240;

  // Click card to open post in background reader
  card.dispatchEvent(new w.MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
  const frame = w.document.querySelector('iframe[data-readscape-reader]');
  assert(frame, 'iframe reader created');

  const child = frame.contentWindow;
  child.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  child.document.open();
  child.document.write('<body><table><tr><td><a id="postauthor0">作者</a></td><td id="postcontainer0"><a id="pid1Anchor"></a><div id="postcontent0" class="postcontent">正文</div></td></tr></table></body>');
  child.document.close();
  child.document.title = '帖子正文';

  await new Promise(resolve => setTimeout(resolve, 0));
  poll();

  assert.equal(frame.style.visibility, 'visible');
  assert(w.document.documentElement.hasAttribute('data-readscape-reader-open'));

  const readerRoot = child.document.querySelector('#nga-cards-host')?.shadowRoot;
  assert(readerRoot, 'reader shadow root exists');
  const readerApp = readerRoot.querySelector('.app.reader');
  assert(readerApp, 'reader app container exists');
  assert.equal(readerApp.tabIndex, -1, 'reader app container should have tabIndex -1');

  // While reader is open, listApp.scrollTop does not change
  assert.equal(listApp.scrollTop, 240);

  // In child reader window, ArrowDown scrolls the post!
  assert.equal(readerApp.scrollTop, 0);
  child.dispatchEvent(new child.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.equal(readerApp.scrollTop, 80, 'reader scrolls down with ArrowDown');

  child.dispatchEvent(new child.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.equal(readerApp.scrollTop, 160, 'reader scrolls down again');

  child.dispatchEvent(new child.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  assert.equal(readerApp.scrollTop, 80, 'reader scrolls up with ArrowUp');

  // Verify parent list did NOT scroll while reader was active
  assert.equal(listApp.scrollTop, 240);

  // Now return back to the list
  w.history.replaceState(null, '', '/thread.php?fid=-7');
  w.dispatchEvent(new w.PopStateEvent('popstate', { state: null }));

  assert.equal(w.document.querySelector('iframe[data-readscape-reader]'), null);
  assert(!w.document.documentElement.hasAttribute('data-readscape-reader-open'));
  assert.equal(listApp.scrollTop, 240, 'list scroll position preserved');

  // Now in list window, ArrowDown and ArrowUp work again to browse posts!
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.equal(listApp.scrollTop, 320, 'list scrolls down with ArrowDown after returning');

  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.equal(listApp.scrollTop, 400);

  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  assert.equal(listApp.scrollTop, 320, 'list scrolls up with ArrowUp after returning');

  d.window.close();
});
