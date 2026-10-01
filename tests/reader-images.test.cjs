const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const script = fs.readFileSync(__dirname + '/../dist/readscape-nga.user.js', 'utf8');
const post = (floor, body) => `<table><tr><td><a>#${floor}</a><span id="postauthor${floor}">用户${floor}</span></td><td id="postcontainer${floor}"><a id="pid${floor}Anchor"></a><h3 id="postsubject${floor}">图文首楼</h3><div id="postcontent${floor}" class="postcontent">${body}</div></td></tr></table>`;
function setup(body) {
  const dom = new JSDOM(post(0, body) + post(1, '评论'), { url: 'https://bbs.nga.cn/read.php?tid=123', runScripts: 'dangerously' });
  dom.window.HTMLElement.prototype.scrollTo = function (options) { this.scrollLeft = options.left || 0; };
  dom.window.eval(script);
  return { dom, root: dom.window.document.querySelector('#nga-cards-host').shadowRoot };
}

test('首楼图集保留正文，引用和表格图片留在原处，分页切换复用图片节点', () => {
  const { dom, root } = setup('<p>图前说明</p><a href="https://img.nga.cn/a.png"><img data-src="https://img.nga.cn/full.png" src="https://img.nga.cn/thumb.png" width="600" height="800" onerror="window.hacked=true"></a><p>图后说明</p><img src="/b.png"><div class="quote"><img src="/quote.png"></div><table><tr><td><img src="/table.png"></td></tr></table><img src="https://img.nga.cn/smile/a.png"><img>');
  try {
    const op = root.querySelector('.op');
    assert.equal(op.querySelectorAll('.gallery-slide').length, 2);
    assert.match(op.querySelector('.comment-content').textContent, /图前说明.*图后说明/);
    assert.equal(op.querySelectorAll('.quoted .reader-image').length, 1);
    assert.equal(op.querySelectorAll('table .reader-image').length, 1);
    assert.equal(op.querySelectorAll('img.emoji').length, 1);
    assert.equal(op.querySelectorAll('a a, [onerror]').length, 0);
    assert.equal(op.querySelector('h1').textContent, '图文首楼');
    assert.equal(root.querySelector('.reader-head').hidden, true);
    assert.equal(root.querySelector('.reader .tabs'), null);
    assert(root.querySelector('.rt-more [data-pref=groupReplies]'));
    const image = op.querySelector('.gallery-slide img');
    assert.equal(image.src, 'https://img.nga.cn/full.png');
    assert.equal(image.loading, 'eager');
    assert.equal(image.width, 600);
    op.querySelector('.gallery-slide .attachment').click();
    assert.equal(root.querySelector('.viewer-count').textContent, '1 / 2', '图集查看器不混入引用或表格图片');
    root.querySelector('.viewer-close').click();
    root.querySelector('[data-pref=groupReplies]').click();
    assert.equal(root.querySelector('.gallery-slide img'), image, '切换排列不重新下载已展示的图片');
    const track = root.querySelector('.gallery-track');
    Object.defineProperty(track, 'clientWidth', { value: 300 });
    root.querySelector('.gallery-next').click();
    track.dispatchEvent(new dom.window.Event('scroll'));
    assert.equal(root.querySelector('.gallery-count').textContent, '2 / 2');
    assert.equal(root.querySelector('.gallery-next').disabled, true);
    root.querySelector('[data-pref=groupReplies]').click();
    assert.equal(root.querySelector('.gallery-track').scrollLeft, 300, '重新渲染保留当前图集位置');
  } finally { dom.window.close(); }
});

test('图片加载状态、失败重试和查看器键盘关闭及焦点恢复', () => {
  const { dom, root } = setup('<img src="/a.png" width="600" height="800"><img src="/b.png">');
  try {
    const frame = root.querySelector('.gallery-slide .reader-image'), image = frame.querySelector('img');
    assert.equal(frame.classList.contains('is-loading'), true);
    image.dispatchEvent(new dom.window.Event('error'));
    assert.equal(frame.classList.contains('is-error'), true);
    assert.equal(frame.querySelector('.image-retry').hidden, false);
    frame.querySelector('.image-retry').click();
    assert.equal(frame.classList.contains('is-loading'), true);
    Object.defineProperty(image, 'naturalWidth', { value: 600 });
    Object.defineProperty(image, 'naturalHeight', { value: 800 });
    image.dispatchEvent(new dom.window.Event('load'));
    assert.equal(frame.classList.contains('is-loaded'), true);
    assert.equal(frame.querySelector('.image-retry').hidden, true);
    const attachment = frame.querySelector('.attachment');
    attachment.click();
    const viewer = root.querySelector('.image-viewer');
    assert.equal(viewer.open, true);
    assert.equal(viewer.querySelector('.viewer-count').textContent, '1 / 2');
    viewer.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(viewer.querySelector('.viewer-count').textContent, '2 / 2');
    assert.equal(viewer.querySelector('.viewer-original').href, 'https://bbs.nga.cn/b.png');
    assert.equal(viewer.querySelector('.viewer-next').disabled, true);
    viewer.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(viewer.open, false);
    assert.equal(root.activeElement, attachment);
    assert.equal(dom.window.hacked, undefined);
  } finally { dom.window.close(); }
});

test('纯文字首楼仍显示标题，从后续页打开时保留页面标题和评论排列', () => {
  const { dom, root } = setup('<p>没有图片的首楼</p>');
  try {
    assert.equal(root.querySelector('.note-gallery'), null);
    assert.equal(root.querySelector('.note-title').textContent, '图文首楼');
  } finally { dom.window.close(); }
  const later = new JSDOM('<title>后续页 NGA玩家社区</title>' + post(20, '后续评论'), { url: 'https://bbs.nga.cn/read.php?tid=123&page=2', runScripts: 'dangerously' });
  try {
    later.window.eval(script);
    const laterRoot = later.window.document.querySelector('#nga-cards-host').shadowRoot;
    assert.equal(laterRoot.querySelector('.reader-head').hidden, false);
    assert.equal(laterRoot.querySelector('.reader h1').textContent, '后续页');
    assert.equal(laterRoot.querySelector('.reader .tabs'), null);
    assert(laterRoot.querySelector('.rt-more [data-pref=groupReplies]'));
  } finally { later.window.close(); }
});
