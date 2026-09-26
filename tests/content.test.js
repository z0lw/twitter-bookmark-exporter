const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function runContent(file, responses) {
  let listener;
  const messages = [];
  const urls = [];
  const insertedButtons = [];
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  let saved = 0;
  const runtime = {
    onMessage: {addListener(fn) { listener = fn; }},
    sendMessage(message) {
      messages.push(message);
      if (message.action === 'fetch_page') return Promise.resolve({count: ++saved});
      if (message.action === 'finish_download') finish(message);
      return Promise.resolve({});
    }
  };
  const element = () => ({
    style: {}, dataset: {}, appendChild() {}, remove() {}, setAttribute() {},
    parentNode: null
  });
  const header = {querySelector() { return null; }, insertBefore(node) { insertedButtons.push(node); }};
  const searchButton = {parentElement: {parentElement: header}};
  const context = {
    console: {log() {}, warn() {}, error() {}},
    window: {location: {href: 'https://x.com/i/history'}},
    location: {pathname: '/i/history', origin: 'https://x.com'},
    document: {
      documentElement: {}, body: {appendChild() {}}, cookie: '',
      querySelector(selector) { return selector.includes('button[aria-label=') ? searchButton : null; }, querySelectorAll() { return []; },
      createElement: element
    },
    MutationObserver: class { observe() {} },
    requestAnimationFrame(fn) { fn(); },
    setTimeout(fn) { queueMicrotask(fn); },
    confirm() { return true; },
    URL, Promise, Set,
    fetch: async url => {
      urls.push(new URL(url));
      const reply = responses.shift();
      if (!reply) throw new Error('Unexpected fetch');
      return reply;
    },
    chrome: {runtime},
    browser: {runtime}
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, {filename: file});
  const bookmarksURL = 'https://x.com/i/api/graphql/abc/Bookmarks?variables=' +
    encodeURIComponent(JSON.stringify({count: 40, includePromotedContent: false})) +
    '&features=%7B%22flag%22%3Atrue%7D&fieldToggles=%7B%22x%22%3Atrue%7D';
  const request = {action: 'iconClicked', bookmarksURL, creds: {authorization:'test', 'x-csrf-token':'test'}, otherConfig: {wait_interval_ms:50}};
  const invoked = listener(request, {}, () => {});
  return {finished, messages, urls, invoked, insertedButtons};
}

const entry = id => ({entryId: 'tweet-' + id, content: {itemContent: {tweet_results: {result: {rest_id: id}}}}});
const cursor = value => ({entryId: 'cursor-bottom-1', content: {value}});
const ok = data => ({ok: true, json: async () => data});
const response = instructions => ({data: {bookmark_timeline_v2: {timeline: {instructions}}}});

for (const file of ['chrome-version/content.js', 'firefox-version/content_firefox.js']) {
  test(file + ' requests 200 items per page, keeps X parameters, and finishes after all pages', async () => {
    const pages = [
      ok(response([{entries: [entry('1')]}, {entries: [cursor('next')]}])),
      ok(response([{entries: [entry('2')]}]))
    ];
    const run = runContent(file, pages);
    const result = await run.finished;
    assert.equal(run.insertedButtons.length, 0, 'X画面にはボタンを追加しない');
    assert.equal(result.complete, true);
    assert.equal(run.urls.length, 2);
    assert.equal(JSON.parse(run.urls[0].searchParams.get('variables')).count, 200);
    assert.equal(JSON.parse(run.urls[1].searchParams.get('variables')).count, 200);
    assert.equal(run.urls[0].searchParams.get('fieldToggles'), '{"x":true}');
    assert.equal(JSON.parse(run.urls[1].searchParams.get('variables')).cursor, 'next');
    assert.equal(run.messages.filter(message => message.action === 'fetch_page').length, 2);
  });

  test(file + ' stops after bounded HTTP failures without recording completion', async () => {
    const run = runContent(file, [
      {ok: false, status: 429}, {ok: false, status: 429}, {ok: false, status: 429}
    ]);
    const result = await run.finished;
    assert.equal(result.complete, false);
    assert.equal(run.urls.length, 3);
    assert.equal(run.messages.filter(message => message.action === 'fetch_page').length, 0);
  });
}
