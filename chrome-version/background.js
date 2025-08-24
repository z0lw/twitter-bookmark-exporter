// ローカル版 Twitter Bookmarks Export Background Script
// 外部サービス通信を削除し、ローカルでの全件エクスポートに対応
// Chrome/Firefox両対応版

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
      customCount: 2000,
      dateLimit: 'all',
      customDate: getDefaultDate(),
      lastExportTimestamp: null
    });
    
    // 日付フィルタリング: 古いツイートを個別に除外
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
        case 'last_export':
          if (settings.lastExportTimestamp) {
            cutoffDate = new Date(settings.lastExportTimestamp);
            console.log('📅 Using last export timestamp:', cutoffDate.toISOString());
          }
          break;
      }
      
      if (cutoffDate) {
        const originalCount = filteredEntries.length;
        const cutoffTimestamp = cutoffDate.getTime(); // ミリ秒レベルでの厳密な比較
        
        filteredEntries = filteredEntries.filter(entry => {
          const entryTimestamp = Number(BigInt(entry.sortIndex) >> BigInt(20));
          return entryTimestamp >= cutoffTimestamp;
        });
        console.log('📅 Date filtered from', originalCount, 'to', filteredEntries.length, 'entries (cutoff:', cutoffDate.toISOString(), ')');
      }
    }
    
    // 件数制限チェック
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
    
    // 重複を除外してユニークなブックマーク数をカウント（すべて含む）
    const uniqueBookmarks = bookmarks.filter((bookmark, index, array) => {
      if (bookmark.content?.itemContent?.tweet_results?.result?.rest_id) {
        const tweetId = bookmark.content.itemContent.tweet_results.result.rest_id;
        return array.findIndex(b => b.content?.itemContent?.tweet_results?.result?.rest_id === tweetId) === index;
      }
      return true; // IDがない場合は残す
    });
    
    // バッジにユニークカウント表示
    chrome.action.setBadgeText({text: uniqueBookmarks.length.toString()});
    console.log('📊 Total bookmarks:', bookmarks.length, '(unique:', uniqueBookmarks.length, ')');
    
    // 制限に達したら強制停止をcontent scriptに通知（finish_downloadは送信しない）
    if (settings.countLimit !== 'all') {
      const maxCount = settings.countLimit === 'custom' ? settings.customCount : parseInt(settings.countLimit);
      if (uniqueBookmarks.length >= maxCount) {
        console.log('📊 Reached unique count limit in background, signaling content script to stop');
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
        // 最終的に重複を除外したユニークなブックマークを保存（すべて含む）
        const finalBookmarks = bookmarks.filter((bookmark, index, array) => {
          if (bookmark.content?.itemContent?.tweet_results?.result?.rest_id) {
            const tweetId = bookmark.content.itemContent.tweet_results.result.rest_id;
            return array.findIndex(b => b.content?.itemContent?.tweet_results?.result?.rest_id === tweetId) === index;
          }
          return true; // IDがない場合は残す
        });
        
        const finalCount = finalBookmarks.length;
        console.log('✅ Finishing download with', bookmarks.length, 'total bookmarks (', finalCount, 'unique)');
        
        // エクスポート完了時刻を記録（秒単位の精度）
        const exportTimestamp = new Date().getTime();
        
        // ローカルストレージに保存
        chrome.storage.local.set({
          bookmarks: JSON.stringify(finalBookmarks),
          sync_at: exportTimestamp
        }).then(() => {
          console.log('💾 Bookmarks saved to storage, count:', finalCount);
          
          // 前回エクスポート日時を設定に記録
          chrome.storage.sync.set({
            lastExportTimestamp: exportTimestamp
          }, () => {
            console.log('📅 Export timestamp saved:', new Date(exportTimestamp).toISOString());
          });
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
  
  // 日付制限は個別フィルタリングで処理するため、停止条件からは削除
  
  console.log('📋 Applied stop condition:', stopCondition);
  
  let config = {
    script_ver: 1,
    wait_interval_ms: 50
  };
  
  if (isDownloading) {
    console.log('⚠️ Already downloading, sending abort confirmation');
    if (currentTab) {
      chrome.tabs.sendMessage(currentTab.id, {action: "abortConfirm", script_ver: config.script_ver});
    }
    return;
  }
  
  if (Object.keys(credentials).length === 2 && bookmarksURL && currentTab) {
    isDownloading = true;
    bookmarks = []; // 確実にリセット
    console.log('🧹 Reset bookmarks array before download');
    console.log('✅ Sending iconClicked message to tab:', currentTab.id);
    chrome.tabs.sendMessage(currentTab.id, {
      action: "iconClicked",
      creds: credentials,
      bookmarksURL: bookmarksURL,
      stopCondition: stopCondition,
      otherConfig: config,
      script_ver: config.script_ver
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('❌ Message send error:', chrome.runtime.lastError.message);
        console.log('🔄 Retrying message send in 2 seconds...');
        setTimeout(() => {
          chrome.tabs.sendMessage(currentTab.id, {
            action: "iconClicked",
            creds: credentials,
            bookmarksURL: bookmarksURL,
            stopCondition: stopCondition,
            otherConfig: config,
            script_ver: config.script_ver
          });
        }, 2000);
      }
    });
  } else {
    chrome.tabs.create({url: "https://x.com/i/bookmarks"}, (tab) => {
      currentTab = tab;
      let checkInterval = setInterval(() => {
        if (Object.keys(credentials).length === 2 && bookmarksURL) {
          isDownloading = true;
          bookmarks = []; // 確実にリセット
          console.log('🧹 Reset bookmarks array before download (new tab)');
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

// ブックマークURLの取得（カーソルを除去して最初から開始）
chrome.webRequest.onBeforeRequest.addListener((details) => {
  if (details.url.includes("Bookmarks")) {
    // カーソルパラメータを除去して最初から開始するためのクリーンなURLを保存
    let cleanURL = details.url;
    try {
      let urlObj = new URL(details.url);
      let variables = JSON.parse(urlObj.searchParams.get('variables'));
      delete variables.cursor; // カーソルを削除
      urlObj.searchParams.set('variables', JSON.stringify(variables));
      cleanURL = urlObj.toString();
    } catch (e) {
      console.log('Failed to clean URL, using original:', e);
    }
    
    bookmarksURL = cleanURL;
    console.log('🔗 Got clean bookmarks URL:', cleanURL.substring(0, 50) + '...');
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