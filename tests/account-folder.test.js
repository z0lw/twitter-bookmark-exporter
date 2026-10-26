const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

// 実際の不具合: Xのプロフィールリンクが /44m9/all になり、出力先が Twitter-Bookmarks_44m9all に分かれた
function sentAccountInfo(file, {profileHref, switcherText, cookie = 'twid=u%3D1890135709'}) {
  const messages = [];
  const runtime = {
    onMessage: {addListener() {}},
    sendMessage(message) { messages.push(message); return Promise.resolve({}); }
  };
  const context = {
    console: {log() {}, warn() {}, error() {}},
    window: {location: {href: 'https://x.com/i/bookmarks'}},
    location: {pathname: '/i/bookmarks', origin: 'https://x.com'},
    document: {
      documentElement: {}, body: {appendChild() {}}, cookie,
      querySelector(selector) {
        if (selector.includes('AppTabBar_Profile_Link') && profileHref) return {href: profileHref};
        return null;
      },
      querySelectorAll(selector) {
        if (selector.includes('SideNav_AccountSwitcher_Button') && switcherText) return [{textContent: switcherText}];
        return [];
      },
      createElement: () => ({style: {}, dataset: {}, appendChild() {}, remove() {}, setAttribute() {}})
    },
    MutationObserver: class { observe() {} },
    requestAnimationFrame(fn) { fn(); },
    setTimeout(fn) { queueMicrotask(fn); },
    URL, Promise, Set,
    chrome: {runtime},
    browser: {runtime}
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, {filename: file});
  return messages.find(m => m.action === 'set_account_info').accountInfo;
}

function loadBackground(file) {
  let listener;
  const store = {};
  const local = {
    async get(defaults) {
      const keys = typeof defaults === 'string' ? {[defaults]: undefined} : defaults;
      const out = {};
      for (const [k, v] of Object.entries(keys)) out[k] = k in store ? JSON.parse(JSON.stringify(store[k])) : v;
      return out;
    },
    async set(values) { Object.assign(store, JSON.parse(JSON.stringify(values))); }
  };
  const api = {
    runtime: {onMessage: {addListener(fn) { listener = fn; }}, onInstalled: {addListener() {}}, lastError: null},
    storage: {sync: {get: async (d) => d}, local},
    tabs: {sendMessage() { return Promise.resolve(); }, onRemoved: {addListener() {}}},
    action: {setBadgeText() {}, setBadgeBackgroundColor() {}},
    browserAction: {setBadgeText() {}, setBadgeBackgroundColor() {}},
    webRequest: {onBeforeSendHeaders: {addListener() {}}, onBeforeRequest: {addListener() {}}}
  };
  const sandbox = {chrome: api, browser: api, console: {log() {}, error() {}, warn() {}},
    importScripts() {}, setTimeout, URL, Date, BigInt, Set, Promise};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, {filename: file});
  async function send(message) {
    if (file.startsWith('chrome')) return new Promise(resolve => listener(message, {}, resolve));
    return listener(message, {}, () => {});
  }
  return {send, store};
}

for (const file of ['chrome-version/content.js', 'firefox-version/content_firefox.js']) {
  test(file + ' takes only the handle from a profile link such as /44m9/all', () => {
    const info = sentAccountInfo(file, {profileHref: 'https://x.com/44m9/all'});
    assert.equal(info.screenName, '44m9');
    assert.equal(info.folderSuffix, '44m9');
  });

  test(file + ' ignores account switcher text that is not a valid handle', () => {
    const info = sentAccountInfo(file, {switcherText: '@44m9 all'});
    assert.equal(info.screenName, undefined);
    assert.equal(info.folderSuffix, '5709');
  });
}

for (const file of ['chrome-version/background.js', 'firefox-version/background_firefox.js']) {
  test(file + ' keeps the folder name of an account when the screen name is missing', async () => {
    const {send, store} = loadBackground(file);
    await send({action: 'set_account_info', accountInfo: {userId: '1890135709', screenName: '44m9', folderSuffix: '44m9'}});
    assert.equal(store.accountInfo.folderSuffix, '44m9');
    await send({action: 'set_account_info', accountInfo: {userId: '1890135709', folderSuffix: '5709'}});
    assert.equal(store.accountInfo.folderSuffix, '44m9');
    assert.deepEqual(store.accountFolderSuffixes, {'1890135709': '44m9'});
  });

  test(file + ' falls back to the user id only for an unseen account', async () => {
    const {send, store} = loadBackground(file);
    await send({action: 'set_account_info', accountInfo: {userId: '91489387', folderSuffix: '9387'}});
    assert.equal(store.accountInfo.folderSuffix, '9387');
    assert.equal(store.accountFolderSuffixes, undefined);
  });
}

