// Firefox版 Twitter Bookmarks Export Background Script
// Chrome版（background_local.js）をベースに作成

let credentials = {};
let bookmarksURL = null;
let isDownloading = false;
let bookmarks = [];
let currentTab = null;
let pageLoadListener = null;

function getDefaultDate() {
  const date = new Date();
  date.setMonth(date.getMonth() - 1);
  return date.toISOString().split('T')[0];
}

function getBookmarkTimeline(response) {
  return response.data.bookmark_timeline_v2 || response.data.bookmark_collection_timeline;
}

// メッセージリスナー
browser.runtime.onMessage.addListener(async function(message, sender, sendResponse) {
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
    const settings = await browser.storage.local.get({
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
    browser.browserAction.setBadgeText({text: uniqueBookmarks.length.toString()});
    console.log('📊 Total bookmarks:', bookmarks.length, '(unique:', uniqueBookmarks.length, ')');
    
    // 制限に達したら強制停止をcontent scriptに通知（finish_downloadは送信しない）
    if (settings.countLimit !== 'all') {
      const maxCount = settings.countLimit === 'custom' ? settings.customCount : parseInt(settings.countLimit);
      if (uniqueBookmarks.length >= maxCount) {
        console.log('📊 Reached unique count limit in background, signaling content script to stop');
        browser.tabs.sendMessage(currentTab.id, {action: "stop_download", reason: "count_limit_reached"});
        // returnしてこのページの処理を終了
        return;
      }
    }
  } else if (message.action === "finish_download") {
    if (isDownloading) { // ダウンロード中でない場合は無視
      // 少し待ってから処理を開始（進行中のfetch_pageを待つため）
      setTimeout(() => {
        isDownloading = false;
        browser.browserAction.setBadgeText({text: ""});
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
        browser.storage.local.set({
          bookmarks: JSON.stringify(finalBookmarks),
          sync_at: exportTimestamp
        }).then(() => {
          console.log('💾 Bookmarks saved to storage, count:', finalCount);
          
          // 前回エクスポート日時を設定に記録
          browser.storage.local.set({
            lastExportTimestamp: exportTimestamp
          }, () => {
            console.log('📅 Export timestamp saved:', new Date(exportTimestamp).toISOString());
          });
          // ダウンロード完了後は結果ページを開く（データ件数をURLパラメータで渡す）
          // デバッグのためページを閉じずに新しいタブで開く
          browser.tabs.create({
            url: browser.runtime.getURL('download_result_firefox.html') + '?count=' + finalCount
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
    browser.browserAction.setBadgeText({text: ""});
    bookmarks = []; // bookmarks配列もリセット
    if (currentTab) {
      browser.tabs.remove(currentTab.id);
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
    console.log('🔍 Current isDownloading:', isDownloading);
    
    // 強制的にリセット（前回の処理が残っている場合）
    if (isDownloading) {
      console.log('⚠️ Resetting previous download state');
      isDownloading = false;
      bookmarks = [];
    }
    
    // 現在のアクティブタブを確認
    browser.tabs.query({active: true, currentWindow: true}).then((tabs) => {
      if (tabs[0] && tabs[0].url.includes("bookmarks")) {
        currentTab = tabs[0];
        console.log('📌 Found current tab:', currentTab.id, currentTab.url);
      } else {
        currentTab = null;
      }
      startDownload(null, null);
    });
  } else if (message.action === "get_bookmarks") {
    // 結果ページからのデータ要求
    console.log('📤 get_bookmarks request received');
    browser.storage.local.get(['bookmarks']).then((result) => {
      console.log('📚 Sending bookmarks data, size:', result.bookmarks ? result.bookmarks.length : 'null');
      sendResponse({bookmarks: result.bookmarks});
    }).catch((error) => {
      console.error('Storage error:', error);
      sendResponse({error: error.message});
    });
    return true; // 非同期レスポンスのため
  } else if (message.action === "fetch_network_error") {
    console.log("Network error:", message.error);
  }
  
  return true;
});

// バッジ色設定
browser.browserAction.setBadgeBackgroundColor({color: "#1CA8FE"});

const startDownload = async (event, stopSortIndex = null) => {
  console.log('Starting download with stopSortIndex:', stopSortIndex);
  console.log('🔍 Current state - isDownloading:', isDownloading, 'credentials:', Object.keys(credentials).length, 'bookmarksURL:', bookmarksURL, 'currentTab:', currentTab?.id);
  console.log('🔑 Credentials details:', credentials);
  
  // 設定を読み込み
  const settings = await browser.storage.local.get({
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
      browser.tabs.sendMessage(currentTab.id, {action: "abortConfirm", script_ver: config.script_ver});
    }
    return;
  }
  
  if (Object.keys(credentials).length === 2 && bookmarksURL && currentTab) {
    isDownloading = true;
    bookmarks = []; // 確実にリセット
    console.log('🧹 Reset bookmarks array before download');
    console.log('✅ Sending iconClicked message to tab:', currentTab.id);
    browser.tabs.sendMessage(currentTab.id, {
      action: "iconClicked",
      creds: credentials,
      bookmarksURL: bookmarksURL,
      stopCondition: stopCondition,
      otherConfig: config,
      script_ver: config.script_ver
    }).then((response) => {
      console.log('✅ Message sent successfully');
    }).catch((error) => {
      console.error('❌ Message send error:', error);
      console.log('🔄 Retrying message send in 2 seconds...');
      setTimeout(() => {
        browser.tabs.sendMessage(currentTab.id, {
          action: "iconClicked",
          creds: credentials,
          bookmarksURL: bookmarksURL,
          stopCondition: stopCondition,
          otherConfig: config,
          script_ver: config.script_ver
        });
      }, 2000);
    });
  } else {
    console.log('📌 Looking for existing bookmarks tab or creating new one');
    // bookmarksURLをリセットして新しく取得できるようにする
    bookmarksURL = null;
    
    // まず既存のブックマークタブを探す
    browser.tabs.query({url: "*://x.com/i/bookmarks*"}).then(async (existingTabs) => {
      let targetTab;
      
      if (existingTabs.length > 0) {
        console.log('📍 Found existing bookmarks tab:', existingTabs[0].id);
        targetTab = existingTabs[0];
        // 既存のタブをアクティブにする
        await browser.tabs.update(targetTab.id, {active: true});
      } else {
        console.log('📌 Creating new tab for bookmarks page');
        targetTab = await browser.tabs.create({url: "https://x.com/i/bookmarks"});
        console.log('✅ New tab created with ID:', targetTab.id);
      }
      
      currentTab = targetTab;
      const targetTabId = targetTab.id;
      console.log('📍 Using tab ID:', targetTabId);
      
      // タブが完全に読み込まれるまで待つ（既存タブの場合はスキップ可能）
      if (targetTab.status !== "complete") {
        await new Promise(resolve => {
          let timeoutId = setTimeout(() => {
            console.log('⚠️ Tab load timeout, continuing anyway');
            browser.tabs.onUpdated.removeListener(onUpdated);
            resolve();
          }, 10000);
          
          function onUpdated(tabId, changeInfo) {
            if (tabId === targetTabId && changeInfo.status === "complete") {
              console.log('✅ Tab fully loaded');
              clearTimeout(timeoutId);
              browser.tabs.onUpdated.removeListener(onUpdated);
              resolve();
            }
          }
          browser.tabs.onUpdated.addListener(onUpdated);
        });
      } else {
        console.log('✅ Tab already loaded');
      }
      
      // bookmarksURLを事前に構築（固定パターン）
      if (!bookmarksURL) {
        bookmarksURL = 'https://x.com/i/api/graphql/3OjEFzT2VjX-X7w4KYBJRg/Bookmarks?variables=%7B%22count%22%3A40%2C%22includePromotedContent%22%3Afalse%7D&features=%7B%22graphql_timeline_v2_bookmark_timeline%22%3Atrue%2C%22blue_business_profile_image_shape_enabled%22%3Atrue%2C%22responsive_web_graphql_exclude_directive_enabled%22%3Atrue%2C%22verified_phone_label_enabled%22%3Afalse%2C%22responsive_web_graphql_timeline_navigation_enabled%22%3Atrue%2C%22responsive_web_graphql_skip_user_profile_image_extensions_enabled%22%3Afalse%2C%22tweetypie_unmention_optimization_enabled%22%3Atrue%2C%22vibe_api_enabled%22%3Atrue%2C%22responsive_web_edit_tweet_api_enabled%22%3Atrue%2C%22graphql_is_translatable_rweb_tweet_is_translatable_enabled%22%3Atrue%2C%22view_counts_everywhere_api_enabled%22%3Atrue%2C%22longform_notetweets_consumption_enabled%22%3Atrue%2C%22tweet_awards_web_tipping_enabled%22%3Afalse%2C%22freedom_of_speech_not_reach_fetch_enabled%22%3Atrue%2C%22standardized_nudges_misinfo%22%3Atrue%2C%22tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled%22%3Afalse%2C%22interactive_text_enabled%22%3Atrue%2C%22responsive_web_text_conversations_enabled%22%3Afalse%2C%22longform_notetweets_rich_text_read_enabled%22%3Atrue%2C%22responsive_web_enhance_cards_enabled%22%3Afalse%7D';
        console.log('📝 Using pre-built bookmarks URL');
      }
      
      // credentialsが取得できるまで待つ
      let retryCount = 0;
      const maxRetries = 20; // 最大10秒待つ
      
      const checkCredentials = async () => {
        retryCount++;
        console.log(`🔄 checkCredentials called, retry ${retryCount}/${maxRetries}`);
        console.log(`📊 Current state: currentTab=${currentTab ? currentTab.id : 'null'}, targetTabId=${targetTabId}`);
        
        // currentTabが変更されていないか確認
        if (!currentTab || currentTab.id !== targetTabId) {
          console.warn(`⚠️ currentTab was changed! currentTab=${currentTab ? currentTab.id : 'null'}, expected=${targetTabId}`);
          // currentTabを復元
          currentTab = targetTab;
        }
        
        // タブがまだ存在するか確認
        try {
          const tab = await browser.tabs.get(targetTabId);
          if (!tab) {
            throw new Error('Tab not found');
          }
        } catch (e) {
          console.error('❌ Tab was closed:', e.message);
          isDownloading = false;
          currentTab = null;
          return;
        }
        
        console.log(`⏳ Waiting for credentials: creds=${Object.keys(credentials).length}/2, retry=${retryCount}/${maxRetries}`);
        
        if (Object.keys(credentials).length === 2) {
          isDownloading = true;
          bookmarks = [];
          console.log('🧹 Reset bookmarks array before download');
          console.log('📤 Sending message to tab:', targetTabId);
          
          browser.tabs.sendMessage(targetTabId, {
            action: "iconClicked",
            creds: credentials,
            bookmarksURL: bookmarksURL,
            stopCondition: stopCondition,
            otherConfig: config,
            script_ver: config.script_ver
          }).then(() => {
            console.log('✅ Message sent successfully');
          }).catch((error) => {
            console.error('❌ Failed to send message:', error);
            isDownloading = false;
            currentTab = null;
          });
        } else if (retryCount < maxRetries) {
          setTimeout(checkCredentials, 500);
        } else {
          console.error('❌ Timeout waiting for credentials');
          isDownloading = false;
          currentTab = null;
        }
      };
      
      // 初回チェックを即座に実行（credentialsは既に取得済みの可能性が高い）
      console.log('⏰ Starting credentials check immediately');
      checkCredentials();
    }).catch((error) => {
      console.error('❌ Failed to query/create tab:', error);
      isDownloading = false;
      currentTab = null;
    });
  }
};

// ポップアップからの呼び出しのみ（アクションボタンクリックは無効）

// タブが閉じられた時の処理
browser.tabs.onRemoved.addListener(async (tabId) => {
  // currentTabが設定されていて、かつブックマークタブの場合のみ処理
  if (currentTab && currentTab.id === tabId && currentTab.url && currentTab.url.includes('/i/bookmarks')) {
    console.log(`📑 Bookmarks tab ${tabId} closed`);
    console.log('⚠️ Current download tab was closed, resetting state');
    isDownloading = false;
    currentTab = null;
    bookmarks = [];
    bookmarksURL = null;
    browser.browserAction.setBadgeText({text: ""});
    
    // onUpdatedリスナーも削除
    if (pageLoadListener) {
      browser.tabs.onUpdated.removeListener(pageLoadListener);
      pageLoadListener = null;
    }
  } else {
    console.log(`📑 Tab ${tabId} closed (not the active bookmarks tab)`);
  }
});

// リクエストヘッダーからクレデンシャル取得
browser.webRequest.onBeforeSendHeaders.addListener(
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
  {urls: ["*://x.com/*", "*://twitter.com/*"]},
  ["requestHeaders", "blocking"]
);

// ブックマークURLの取得（カーソルを除去して最初から開始）
browser.webRequest.onBeforeRequest.addListener((details) => {
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
    browser.tabs.sendMessage(currentTab.id, {action: "selectAllBookmarks"});
  }
}, {urls: ["*://x.com/*", "*://twitter.com/*"]});

// インストール時の処理（外部サービス通信を削除）
browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    browser.tabs.create({
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