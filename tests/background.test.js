const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function loadBackground(file) {
  let listener;
  const badge = [];
  const api = {
    runtime: {onMessage: {addListener(fn) { listener = fn; }}, onInstalled: {addListener() {}}, lastError: null},
    storage: {
      sync: {get: async () => ({countLimit: '2', dateLimit: 'all'})},
      local: {get: async () => ({countLimit: '2', dateLimit: 'all'})}
    },
    tabs: {sendMessage() { return Promise.resolve(); }, onRemoved: {addListener() {}}},
    action: {setBadgeText(value) {badge.push(value.text);}, setBadgeBackgroundColor() {}},
    browserAction: {setBadgeText(value) {badge.push(value.text);}, setBadgeBackgroundColor() {}},
    webRequest: {onBeforeSendHeaders: {addListener() {}}, onBeforeRequest: {addListener() {}}}
  };
  const sandbox = {chrome: api, browser: api, console: {log() {}, error() {}},
    importScripts() {}, setTimeout, URL, Date, BigInt, Set, Promise};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, {filename: file});
  return {listener, badge};
}

function entry(id) {
  return {entryId: 'tweet-' + id, sortIndex:'1', content:{itemContent:{tweet_results:{result:{rest_id:id}}}}};
}
const page = entries => ({data:{bookmark_timeline_v2:{timeline:{instructions:[{entries}]}}}});

for (const file of ['chrome-version/background.js', 'firefox-version/background_firefox.js']) {
  test(file + ' acknowledges unique count and count limit', async () => {
    const {listener, badge} = loadBackground(file);
    async function send(message) {
      if (file.startsWith('chrome')) {
        return new Promise(resolve => listener(message, {}, resolve));
      }
      return listener(message, {}, () => {});
    }
    assert.equal((await send({action:'fetch_page',page:page([entry('1'),entry('1')])})).count, 1);
    assert.equal((await send({action:'fetch_page',page:page([entry('1'),entry('2'),entry('3')])})).count, 2);
    assert.equal(badge.at(-1), '2');
  });
}
