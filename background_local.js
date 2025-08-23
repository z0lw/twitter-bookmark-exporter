// ローカル版 Twitter Bookmarks Export Background Script
// 外部サービス通信を削除し、ローカルでの全件エクスポートに対応

let credentials = {};
let bookmarksURL = null;
let isDownloading = false;
let bookmarks = [];
let currentTab = null;

function getDefaultDate() {
  const date = new Date();
  date.setMonth(date.getMonth() - 1);
  return date.toISOString().split('T')[0];
}

function getBookmarkTimeline(response) {
  return response.data.bookmark_timeline_v2 || response.data.bookmark_collection_timeline;
}

// メッセージリスナー
chrome.runtime.onMessage.addListener(async function(message, sender, sendResponse) {
  if (message.action === "start_download") {
    if (sender.tab && sender.tab.url.includes("i/bookmarks")) {
      currentTab = sender.tab;
    }
    startDownload();
  } else if (message.action === "fetch_page") {
    let entries = getBookmarkTimeline(message.page).timeline.instructions[0].entries || [];
    let filteredEntries = entries.filter(entry => !entry.entryId.startsWith("cursor-"));
    console.log('📦 Received page with', entries.length, 'entries, filtered to', filteredEntries.length, 'bookmarks');
    
    // 制限チェック：設定された件数に到達していたら残りをカットする
    const settings = await chrome.storage.sync.get({
      countLimit: 'all',
      customCount: 2000
    });
    
    if (settings.countLimit !== 'all') {
      const maxCount = settings.countLimit === 'custom' ? settings.customCount : parseInt(settings.countLimit);
      const currentCount = bookmarks.length;
      const remainingSlots = maxCount - currentCount;
      
      if (remainingSlots <= 0) {
        console.log('📊 Already reached limit, ignoring this page');
        return;
      } else if (filteredEntries.length > remainingSlots) {
        filteredEntries = filteredEntries.slice(0, remainingSlots);
        console.log('📊 Limited entries to', filteredEntries.length, 'to fit remaining slots');
      }
    }
    
    bookmarks = bookmarks.concat(filteredEntries);
    
    // バッジにカウント表示
    chrome.action.setBadgeText({text: bookmarks.length.toString()});
    console.log('📊 Total bookmarks now:', bookmarks.length);
    
    // 制限に達したら強制停止をcontent scriptに通知（finish_downloadは送信しない）
    if (settings.countLimit !== 'all') {
      const maxCount = settings.countLimit === 'custom' ? settings.customCount : parseInt(settings.countLimit);
      if (bookmarks.length >= maxCount) {
        console.log('📊 Reached count limit in background, signaling content script to stop');
        chrome.tabs.sendMessage(currentTab.id, {action: "stop_download", reason: "count_limit_reached"});
        // returnしてこのページの処理を終了
        return;
      }
    }
  } else if (message.action === "finish_download") {
    if (isDownloading) { // ダウンロード中でない場合は無視
      // 少し待ってから処理を開始（進行中のfetch_pageを待つため）
      setTimeout(() => {
        isDownloading = false;
        chrome.action.setBadgeText({text: ""});
        console.log('✅ Finishing download with', bookmarks.length, 'total bookmarks');
        
        const finalBookmarks = [...bookmarks]; // コピーを作成
        const finalCount = finalBookmarks.length;
        
        // ローカルストレージに保存
        chrome.storage.local.set({
          bookmarks: JSON.stringify(finalBookmarks),
          sync_at: new Date().getTime()
        }).then(() => {
          console.log('💾 Bookmarks saved to storage, count:', finalCount);
          // ダウンロード完了後は結果ページを開く（データ件数をURLパラメータで渡す）
          // デバッグのためページを閉じずに新しいタブで開く
          chrome.tabs.create({
            url: chrome.runtime.getURL('download_result.html') + '?count=' + finalCount
          });
          
          // リセットはページ作成後に実行
          bookmarks = [];
        });
      }, 100); // 100ms待機
    } else {
      console.log('🚫 Ignoring finish_download - not downloading');
    }
  } else if (message.action === "abort") {
    isDownloading = false;
    chrome.action.setBadgeText({text: ""});
    if (currentTab) {
      chrome.tabs.remove(currentTab.id);
      currentTab = null;
    }
  } else if (message.action === "fetch_error") {
    console.log("Fetch error:", message.errors);
  } else if (message.action === "partial_fetch_error") {
    console.log("Partial fetch error:", message.payload);
  } else if (message.action === "sync_newly") {
    startDownload(null, message.stopSortIndex);
  } else if (message.action === "download_all") {
    // 全件出力専用（停止条件なし）
    console.log('🚀 Background: download_all received');
    startDownload(null, null);
  } else if (message.action === "popup_download_all") {
    // ポップアップからのダウンロード開始（設定に基づく制限あり）
    console.log('🚀 Background: popup_download_all received');
    startDownload(null, null);
  } else if (message.action === "get_bookmarks") {
    // 結果ページからのデータ要求
    console.log('📤 get_bookmarks request received');
    try {
      chrome.storage.local.get(['bookmarks']).then((result) => {
        console.log('📚 Sending bookmarks data, size:', result.bookmarks ? result.bookmarks.length : 'null');
        if (sendResponse) {
          sendResponse({bookmarks: result.bookmarks});
        }
      }).catch((error) => {
        console.error('Storage error:', error);
        if (sendResponse) {
          sendResponse({error: error.message});
        }
      });
    } catch (error) {
      console.error('Get bookmarks error:', error);
      if (sendResponse) {
        sendResponse({error: error.message});
      }
    }
    return true; // 非同期レスポンスのため
  } else if (message.action === "fetch_network_error") {
    console.log("Network error:", message.error);
  }
  
  return true;
});

// バッジ色設定
chrome.action.setBadgeBackgroundColor({color: "#1CA8FE"});

const startDownload = async (event, stopSortIndex = null) => {
  console.log('Starting download with stopSortIndex:', stopSortIndex);
  console.log('🔍 Current state - isDownloading:', isDownloading, 'credentials:', Object.keys(credentials).length, 'bookmarksURL:', bookmarksURL, 'currentTab:', currentTab?.id);
  
  // 設定を読み込み
  const settings = await chrome.storage.sync.get({
    countLimit: 'all',
    customCount: 2000,
    dateLimit: 'all',
    customDate: getDefaultDate()
  });
  
  console.log('📋 Loaded settings:', settings);
  
  // 停止条件を計算
  let stopCondition = null;
  
  if (settings.countLimit !== 'all') {
    const maxCount = settings.countLimit === 'custom' ? settings.customCount : parseInt(settings.countLimit);
    stopCondition = { type: 'count', value: maxCount };
    console.log('📊 Count stop condition set:', stopCondition);
  }
  
  if (settings.dateLimit !== 'all') {
    let cutoffDate;
    const now = new Date();
    
    switch (settings.dateLimit) {
      case '1month':
        cutoffDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
      case '3month':
        cutoffDate = new Date(now.setMonth(now.getMonth() - 3));
        break;
      case '6month':
        cutoffDate = new Date(now.setMonth(now.getMonth() - 6));
        break;
      case '1year':
        cutoffDate = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      case 'custom':
        cutoffDate = new Date(settings.customDate);
        break;
    }
    
    if (cutoffDate) {
      // 日付停止条件がある場合は、そちらを優先（または両方適用）
      if (stopCondition) {
        // 両方ある場合は、早く到達する方で停止
        stopCondition = { type: 'both', count: stopCondition.value, date: cutoffDate.toISOString() };
      } else {
        stopCondition = { type: 'date', value: cutoffDate.toISOString() };
      }
    }
  }
  
  console.log('📋 Applied stop condition:', stopCondition);
  
  let config = {
    script_ver: 1,
    wait_interval_ms: 50
  };
  
  if (isDownloading) {
    chrome.tabs.sendMessage(currentTab.id, {action: "abortConfirm", script_ver: config.script_ver});
    return;
  }
  
  if (Object.keys(credentials).length === 2 && bookmarksURL && currentTab) {
    isDownloading = true;
    bookmarks = []; // ここでリセット
    console.log('✅ Sending iconClicked message to tab:', currentTab.id);
    chrome.tabs.sendMessage(currentTab.id, {
      action: "iconClicked",
      creds: credentials,
      bookmarksURL: bookmarksURL,
      stopCondition: stopCondition,
      otherConfig: config,
      script_ver: config.script_ver
    });
  } else {
    chrome.tabs.create({url: "https://x.com/i/bookmarks"}, (tab) => {
      currentTab = tab;
      let checkInterval = setInterval(() => {
        if (Object.keys(credentials).length === 2 && bookmarksURL) {
          isDownloading = true;
          bookmarks = []; // ここでリセット
          chrome.tabs.sendMessage(currentTab.id, {
            action: "iconClicked",
            creds: credentials,
            bookmarksURL: bookmarksURL,
            stopCondition: stopCondition,
            otherConfig: config,
            script_ver: config.script_ver
          });
          clearInterval(checkInterval);
        }
      }, 500);
    });
  }
};

// アクションボタンクリック（ポップアップが表示されるので削除）
// chrome.action.onClicked.addListener(startDownload);

// リクエストヘッダーからクレデンシャル取得
chrome.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    for (let i = 0; i < details.requestHeaders.length; ++i) {
      if (details.requestHeaders[i].name === "x-csrf-token") {
        credentials["x-csrf-token"] = details.requestHeaders[i].value;
        console.log('🔑 Got x-csrf-token');
      } else if (details.requestHeaders[i].name === "authorization") {
        credentials.authorization = details.requestHeaders[i].value;
        console.log('🔑 Got authorization');
      }
    }
    return {requestHeaders: details.requestHeaders};
  },
  {urls: ["*://x.com/*"]},
  ["requestHeaders"]
);

// ブックマークURLの取得
chrome.webRequest.onBeforeRequest.addListener((details) => {
  if (details.url.includes("Bookmarks")) {
    bookmarksURL = details.url;
    console.log('🔗 Got bookmarks URL:', details.url.substring(0, 50) + '...');
  } else if (details.url.includes("BookmarkFoldersSlice") && currentTab) {
    // Premium user detection - select all bookmarks
    chrome.tabs.sendMessage(currentTab.id, {action: "selectAllBookmarks"});
  }
}, {urls: ["*://x.com/*"]});

// インストール時の処理（外部サービス通信を削除）
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({
      url: "data:text/html," + encodeURIComponent(`
        <html>
        <head><title>Twitter Bookmarks Export - Local</title></head>
        <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #f0f8ff;">
          <h1 style="color: #1da1f2;">🎉 インストール完了</h1>
          <h2>Twitter Bookmarks Export - Local</h2>
          <p>✅ ローカル版がインストールされました</p>
          <p>🔒 外部サービス通信は削除され、すべてローカルで処理されます</p>
          <p>🚀 <a href="https://x.com/i/bookmarks" target="_blank">ブックマークページ</a>で青いボタンをクリックして開始</p>
          <div style="background: #e8f5fd; padding: 20px; border-radius: 10px; margin-top: 20px;">
            <h3>使い方</h3>
            <p>1. Twitter/X のブックマークページを開く</p>
            <p>2. 左側の青いボタン（🚀）をクリック</p>
            <p>3. 全件ダウンロードが完了したらファイル形式を選択</p>
          </div>
        </body>
        </html>
      `)
    });
  }
});