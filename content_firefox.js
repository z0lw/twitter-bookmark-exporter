// Firefox版 Twitter Bookmarks Export Content Script
// 全件出力対応、外部サービス通信を削除

console.log('🔍 Firefox content script loaded on:', window.location.href);

// ブラウザAPI統一
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

function getBookmarkTimeline(response) {
  let timeline = response.data.bookmark_timeline_v2 ? "bookmark_timeline_v2" : "bookmark_collection_timeline";
  return response.data[timeline];
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

browserAPI.runtime.onMessage.addListener(async function(message, sender, sendResponse) {
  let overlay;
  console.log('📧 Firefox content script received message:', message.action);
  
  if (message.action === "iconClicked") {
    console.log('🎯 Processing iconClicked with bookmarksURL:', message.bookmarksURL);
    let baseURL = message.bookmarksURL.split("?")[0];
    let queryParams = message.bookmarksURL.split("?")[1];
    let stopCondition = message.stopCondition;
    let config = message.otherConfig;
    console.log('🎯 Stop condition:', stopCondition);
    let cursor = null;
    let totalCount = 0;

    // ローディングオーバーレイ作成
    overlay = document.createElement("div");
    overlay.id = "bookmark-export-overlay";
    overlay.innerHTML = `
      <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 10000; display: flex; justify-content: center; align-items: center; font-family: 'TwitterChirp', sans-serif;">
        <div style="background: white; padding: 40px; border-radius: 20px; text-align: center; max-width: 400px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
          <div style="font-size: 48px; margin-bottom: 20px;">📥</div>
          <h2 style="color: #1da1f2; margin: 0 0 15px 0; font-size: 24px;">ブックマークをエクスポート中</h2>
          <div id="export-progress" style="color: #657786; font-size: 16px; margin-bottom: 20px;">準備中...</div>
          <div style="width: 100%; background: #f0f0f0; border-radius: 10px; overflow: hidden; margin-bottom: 20px;">
            <div id="progress-bar" style="width: 0%; height: 8px; background: linear-gradient(90deg, #1da1f2, #1a91da); transition: width 0.3s ease;"></div>
          </div>
          <button onclick="document.getElementById('bookmark-export-overlay').remove(); browserAPI.runtime.sendMessage({action: 'abort'});" style="background: #657786; color: white; border: none; padding: 10px 20px; border-radius: 20px; cursor: pointer; font-size: 14px;">キャンセル</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // API呼び出し開始
    let continueLoop = true;
    while (continueLoop) {
      try {
        let currentURL = baseURL + "?" + queryParams;
        if (cursor) {
          // カーソルをURLに追加
          let urlObj = new URL(currentURL);
          let variables = JSON.parse(urlObj.searchParams.get('variables'));
          variables.cursor = cursor;
          urlObj.searchParams.set('variables', JSON.stringify(variables));
          currentURL = urlObj.toString();
        }

        console.log('🌐 Making request:', currentURL);
        
        // プログレス更新
        const progressElement = overlay.querySelector('#export-progress');
        const progressBar = overlay.querySelector('#progress-bar');
        if (progressElement) {
          progressElement.textContent = `${totalCount}件のブックマークを処理中...`;
        }

        const response = await fetch(currentURL, {
          method: 'GET',
          headers: message.creds,
          credentials: 'include'
        });

        if (!response.ok) {
          console.error('❌ Fetch error:', response.status, response.statusText);
          browserAPI.runtime.sendMessage({action: "fetch_error", errors: [response.statusText]});
          break;
        }

        const responseData = await response.json();
        console.log('📦 Response received:', responseData);

        // バックグラウンドにページデータを送信
        browserAPI.runtime.sendMessage({action: "fetch_page", page: responseData});

        let timeline = getBookmarkTimeline(responseData);
        if (!timeline || !timeline.timeline) {
          console.log('⚠️ No timeline data found');
          break;
        }

        let instructions = timeline.timeline.instructions;
        if (!instructions || instructions.length === 0) {
          console.log('⚠️ No instructions found');
          break;
        }

        let entries = instructions[0].entries || [];
        let bookmarkEntries = entries.filter(entry => !entry.entryId.startsWith("cursor-"));
        totalCount += bookmarkEntries.length;

        console.log('📊 This page entries:', entries.length, 'bookmarks:', bookmarkEntries.length, 'total:', totalCount);

        // 次のカーソルを探す
        let nextCursor = null;
        for (let entry of entries) {
          if (entry.entryId.startsWith("cursor-bottom-")) {
            nextCursor = entry.content.value;
            console.log('🔄 Found next cursor:', nextCursor);
            break;
          }
        }

        if (!nextCursor || nextCursor === cursor) {
          console.log('✅ No more pages, finishing download');
          continueLoop = false;
        } else {
          cursor = nextCursor;
        }

        // 停止条件チェック（カウント制限のみ）
        if (stopCondition && stopCondition.type === 'count' && totalCount >= stopCondition.value) {
          console.log(`📊 Reached count limit: ${totalCount} >= ${stopCondition.value}`);
          continueLoop = false;
        }

        // 少し待機
        await delay(config.wait_interval_ms || 50);

      } catch (error) {
        console.error('❌ Network error:', error);
        browserAPI.runtime.sendMessage({action: "fetch_network_error", error: error.message});
        break;
      }
    }

    // オーバーレイを削除
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }

    console.log('✅ Download completed, total count:', totalCount);
    browserAPI.runtime.sendMessage({action: "finish_download"});
  
  } else if (message.action === "stop_download") {
    console.log('⛔ Stop download requested:', message.reason);
    // オーバーレイを削除
    const existingOverlay = document.getElementById("bookmark-export-overlay");
    if (existingOverlay) {
      existingOverlay.remove();
    }
  
  } else if (message.action === "abortConfirm") {
    console.log('🔄 Abort confirmation received');
    // オーバーレイを削除
    const existingOverlay = document.getElementById("bookmark-export-overlay");
    if (existingOverlay) {
      existingOverlay.remove();
    }
  
  } else if (message.action === "selectAllBookmarks") {
    console.log('📋 Selecting all bookmarks for Premium user');
    // Premium userの場合、全ブックマークを選択
    setTimeout(() => {
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach(checkbox => {
        if (!checkbox.checked) {
          checkbox.click();
        }
      });
    }, 1000);
  }

  return true;
});

// 開始ボタンを挿入
function injectStartButton() {
  if (window.location.href.includes('/i/bookmarks')) {
    console.log('📍 On bookmarks page, injecting start button');
    
    setTimeout(() => {
      // 既存のボタンをチェック
      if (document.getElementById('bookmark-export-btn-firefox')) {
        return;
      }

      const button = document.createElement('button');
      button.id = 'bookmark-export-btn-firefox';
      button.innerHTML = '🚀 Firefox版エクスポート';
      button.style.cssText = `
        position: fixed;
        top: 80px;
        left: 20px;
        z-index: 9999;
        background: linear-gradient(135deg, #1da1f2, #1a91da);
        color: white;
        border: none;
        padding: 15px 25px;
        border-radius: 25px;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        box-shadow: 0 4px 15px rgba(29, 161, 242, 0.3);
        transition: all 0.3s ease;
      `;
      
      button.onmouseover = () => {
        button.style.transform = 'translateY(-2px)';
        button.style.boxShadow = '0 6px 20px rgba(29, 161, 242, 0.4)';
      };
      
      button.onmouseout = () => {
        button.style.transform = 'translateY(0)';
        button.style.boxShadow = '0 4px 15px rgba(29, 161, 242, 0.3)';
      };

      button.onclick = () => {
        browserAPI.runtime.sendMessage({action: "start_download"});
      };

      document.body.appendChild(button);
    }, 2000);
  }
}

// ページ変更を監視
let lastURL = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastURL) {
    lastURL = url;
    console.log('🔄 URL changed:', url);
    injectStartButton();
  }
}).observe(document, {subtree: true, childList: true});

// 初期ロード
injectStartButton();