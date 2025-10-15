// ローカル版 Twitter Bookmarks Export Content Script
// 全件出力対応、外部サービス通信を削除

console.log('🔍 Content script loaded on:', window.location.href);

function getBookmarkTimeline(response) {
  let timeline = response.data.bookmark_timeline_v2 ? "bookmark_timeline_v2" : "bookmark_collection_timeline";
  return response.data[timeline];
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractAccountInfo() {
  const info = {};
  let hasInfo = false;

  const sanitize = (value) => String(value).replace(/[^a-zA-Z0-9_\-]/g, '');

  try {
    const metaId = document.querySelector('meta[name="session-user-id"]');
    if (metaId && metaId.content) {
      info.userId = metaId.content.trim();
      hasInfo = true;
    }
    const metaName = document.querySelector('meta[name="session-username"]');
    if (metaName && metaName.content) {
      info.screenName = metaName.content.trim();
      hasInfo = true;
    }
  } catch (error) {
    console.warn('⚠️ Failed to read session meta tags:', error);
  }

  if (!info.userId) {
    try {
      const initialState = window.__INITIAL_STATE__ || window.__META_DATA__;
      const session = initialState?.session || initialState?.user;
      if (session?.user_id) {
        info.userId = String(session.user_id);
        hasInfo = true;
      }
      if (!info.screenName && session?.user?.legacy?.screen_name) {
        info.screenName = session.user.legacy.screen_name;
        hasInfo = true;
      }
      if (!info.screenName && session?.screen_name) {
        info.screenName = session.screen_name;
        hasInfo = true;
      }
    } catch (error) {
      console.warn('⚠️ Failed to parse __INITIAL_STATE__:', error);
    }
  }

  try {
    const cookieString = document.cookie || '';
    const twidMatch = cookieString.match(/(?:^|;\s*)twid=([^;]+)/);
    if (twidMatch) {
      const decoded = decodeURIComponent(twidMatch[1]);
      const idMatch = decoded.match(/u=(\d+)/);
      if (idMatch) {
        info.userId = idMatch[1];
        hasInfo = true;
      }
    }
  } catch (error) {
    console.warn('⚠️ Failed to parse twid cookie:', error);
  }

  if (!info.screenName) {
    try {
      const profileLink = document.querySelector('a[role="link"][data-testid="AppTabBar_Profile_Link"]');
      if (profileLink && profileLink.href) {
        const path = new URL(profileLink.href, location.origin).pathname;
        const handle = path.replace(/^\/+/, '');
        if (handle) {
          info.screenName = handle;
          hasInfo = true;
        }
      }
      if (!info.screenName) {
        const handleElement = Array.from(document.querySelectorAll('div[data-testid="SideNav_AccountSwitcher_Button"] span'))
          .find(el => el.textContent && el.textContent.trim().startsWith('@'));
        if (handleElement) {
          info.screenName = handleElement.textContent.trim().replace(/^@/, '');
          hasInfo = true;
        }
      }
    } catch (error) {
      console.warn('⚠️ Failed to extract screen name from DOM:', error);
    }
  }

  if (info.screenName) {
    const screenSuffix = sanitize(info.screenName);
    if (screenSuffix.length > 0) {
      info.folderSuffix = screenSuffix;
    }
  }
  if (!info.folderSuffix && info.userId) {
    info.folderSuffix = sanitize(info.userId.slice(-4));
  }

  if (!hasInfo) {
    return null;
  }
  return info;
}

chrome.runtime.onMessage.addListener(async function(message, sender, sendResponse) {
  let overlay;
  console.log('📧 Content script received message:', message.action);
  
  if (message.action === "iconClicked") {
    const accountInfo = extractAccountInfo();
    if (accountInfo) {
      chrome.runtime.sendMessage({action: "set_account_info", accountInfo});
    } else {
      chrome.runtime.sendMessage({action: "set_account_info", accountInfo: null});
    }
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
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.backgroundColor = "rgba(0, 0, 0, 0.75)";
    overlay.style.zIndex = "9999";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";

    let spinnerDiv = document.createElement("div");
    spinnerDiv.innerHTML = `
      <svg style="margin-right: 25px; scale: 0.75;" width="65px" height="65px" viewBox="0 0 66 66" xmlns="http://www.w3.org/2000/svg">
        <g>
          <animateTransform attributeName="transform" type="rotate" values="0 33 33;270 33 33" begin="0s" dur="1.4s" fill="freeze" repeatCount="indefinite"/>
          <circle fill="none" stroke-width="6" stroke-linecap="round" cx="33" cy="33" r="30" stroke-dasharray="187" stroke-dashoffset="610">
            <animate attributeName="stroke" values="#4285F4;#DE3E35;#F7C223;#1B9A59;#4285F4" begin="0s" dur="5.6s" fill="freeze" repeatCount="indefinite"/>
            <animateTransform attributeName="transform" type="rotate" values="0 33 33;135 33 33;450 33 33" begin="0s" dur="1.4s" fill="freeze" repeatCount="indefinite"/>
            <animate attributeName="stroke-dashoffset" values="187;46.75;187" begin="0s" dur="1.4s" fill="freeze" repeatCount="indefinite"/>
          </circle>
        </g>
      </svg>
    `;
    overlay.appendChild(spinnerDiv);

    let statusText = document.createElement("h1");
    statusText.textContent = "全件ダウンロード中... このタブを閉じないでください。";
    statusText.style.color = "#fff";
    statusText.style.fontFamily = '"TwitterChirp",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
    overlay.appendChild(statusText);

    // 安全にDOM追加を待つ
    if (!document.body) {
      await delay(500);
    }
    document.body.appendChild(overlay);

    // メインループ：全件取得まで継続
    window.forceStopDownload = false; // 初期化
    while (true) {
      // 強制停止チェック
      if (window.forceStopDownload) {
        console.log('🛑 Force stop detected, breaking loop. Reason:', window.stopReason);
        break;
      }
      
      let response;
      console.log('🔄 Fetching page with cursor:', cursor ? cursor.substring(0, 20) + '...' : 'null');
      try {
        response = await fetchBookmarkPage(cursor, message.creds, baseURL, parseQueryParams(queryParams));
      } catch (error) {
        chrome.runtime.sendMessage({action: "fetch_network_error", error: error.toString()});
        await delay(2000);
        continue;
      }

      let hasData = false;
      if (response?.data) {
        let timeline = getBookmarkTimeline(response);
        hasData = timeline?.timeline?.instructions?.[0]?.entries?.length > 0;
      }

      let hasErrors = false;
      if (response.errors && response.errors.length > 0) {
        hasErrors = true;
      }

      // エラー処理
      if (hasErrors && hasData) {
        chrome.runtime.sendMessage({action: "partial_fetch_error", payload: response});
      }
      
      if (hasErrors && !hasData) {
        chrome.runtime.sendMessage({action: "fetch_error", errors: response.errors});
        if (!confirm("Twitter側でエラーが発生しています。現在取得済みのブックマークを保持しますか？\n（キャンセルすると中止）")) {
          chrome.runtime.sendMessage({action: "abort"});
          setTimeout(() => {
            if (overlay && overlay.parentNode) {
              document.body.removeChild(overlay);
            }
          }, 1000);
          return;
        } else {
          chrome.runtime.sendMessage({action: "finish_download"});
        }
        await delay(5000);
      }

      // カウント更新（カーソルエントリを除いた実際のブックマーク数）
      try {
        let entries = response.data.bookmark_timeline_v2.timeline.instructions[0].entries;
        let bookmarkEntries = entries.filter(entry => !entry.entryId.startsWith("cursor-"));
        totalCount += bookmarkEntries.length;
        statusText.textContent = `全件ダウンロード中... ${totalCount}件取得済み`;
        console.log('📊 Updated count:', totalCount, 'from', bookmarkEntries.length, 'new bookmarks');
      } catch (e) {
        console.error('Count update error:', e);
      }

      // カーソル取得
      cursor = getBookmarkTimeline(response).timeline.instructions[0].entries.find(entry => 
        entry.entryId.startsWith("cursor-bottom-")
      ).content.value;

      // ページデータ送信
      console.log('📤 Sending page data to background, entries count:', getBookmarkTimeline(response).timeline.instructions[0].entries.length);
      chrome.runtime.sendMessage({action: "fetch_page", page: response});

      // 終了条件チェック：エントリが2つのみ（カーソルのみ）の場合は最後のページ
      if (getBookmarkTimeline(response).timeline.instructions[0].entries.length === 2) {
        break;
      }

      // 停止条件チェック（件数制限のみ、日付は個別フィルタリングで処理）
      if (stopCondition && stopCondition.type === "count") {
        console.log('📊 Checking count limit:', totalCount, 'vs', stopCondition.value);
        if (totalCount >= stopCondition.value) {
          console.log('📊 Reached count limit:', totalCount, '>=', stopCondition.value);
          break;
        }
      }
      // 停止条件がない場合は、エントリが2つ（カーソルのみ）になるまで継続

      // 待機時間（最速設定）
      let waitTime = Math.max(50, Math.min(config.wait_interval_ms || 100, 10000));
      await delay(waitTime);
    }

    chrome.runtime.sendMessage({action: "finish_download"});
    setTimeout(() => {
      if (overlay && overlay.parentNode) {
        document.body.removeChild(overlay);
      }
    }, 1000);

  } else if (message.action === "abortConfirm") {
    if (confirm("現在のダウンロード処理を停止しますか？")) {
      chrome.runtime.sendMessage({action: "abort"});
      setTimeout(() => {
        if (overlay && overlay.parentNode) {
          document.body.removeChild(overlay);
        }
      }, 1000);
    }
  } else if (message.action === "selectAllBookmarks") {
    document.querySelector('a[href="/i/bookmarks/all"]').click();
  } else if (message.action === "stop_download") {
    console.log('🛑 Received stop signal from background:', message.reason);
    // グローバル変数でダウンロード停止フラグを設定
    window.forceStopDownload = true;
    window.stopReason = message.reason;
  }
});

// ヘルパー関数
async function fetchBookmarkPage(cursor, credentials, baseURL, params) {
  let variables = JSON.parse(decodeURIComponent(params.variables));
  let features = params.features;
  
  if (cursor) {
    variables.cursor = cursor;
  }
  
  // countを大きくして一度により多くのデータを取得
  variables.count = 200; // デフォルトの20から200に増加
  console.log('🔧 Modified variables:', variables);
  
  return fetch(`${baseURL}?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${features}`, {
    headers: {
      "accept": "*/*",
      "accept-language": "en-US,en;q=0.9,zh-TW;q=0.8,zh;q=0.7",
      "authorization": credentials.authorization,
      "cache-control": "no-cache",
      "content-type": "application/json",
      "pragma": "no-cache",
      "sec-ch-ua": '"Chromium";v="112", "Google Chrome";v="112", "Not:A-Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "sec-gpc": "1",
      "x-csrf-token": credentials["x-csrf-token"],
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-client-language": "zh-tw"
    },
    referrer: "https://x.com/i/bookmarks",
    referrerPolicy: "strict-origin-when-cross-origin",
    body: null,
    method: "GET",
    mode: "cors",
    credentials: "include"
  }).then(response => response.json());
}

function parseQueryParams(queryString) {
  let params = {};
  if (queryString) {
    queryString.split("&").forEach(function(param) {
      let parts = param.split("=");
      let key = decodeURIComponent(parts[0]);
      let value = parts[1] || "";
      if (params[key]) {
        if (Array.isArray(params[key])) {
          params[key].push(value);
        } else {
          params[key] = [params[key], value];
        }
      } else {
        params[key] = value;
      }
    });
  }
  return params;
}

function checkSortIndexCondition(response, sortIndexValue) {
  let timeline = getBookmarkTimeline(response);
  let entries = timeline?.timeline?.instructions?.[0]?.entries;
  return entries && entries.find(entry => entry.sortIndex < sortIndexValue);
}

// 不要になったcheckDateCondition関数を削除
// 日付フィルタリングはbackground_local.jsで個別に処理

// ブックマークページでエクスポートボタンを追加
if (document.location.href.includes("bookmarks")) {
  function addExportButton(selector, callback) {
    new MutationObserver((mutations, observer) => {
      let element = document.querySelector(selector);
      if (element) {
        callback(element);
        observer.disconnect();
      }
    }).observe(document.documentElement, {childList: true, subtree: true});
  }

  addExportButton('div[data-testid="primaryColumn"] div[aria-haspopup="menu"]', (targetElement) => {
    // 全件出力ボタン
    let exportAllButton = document.createElement("div");
    exportAllButton.title = "🚀 全件エクスポート（制限なし）";
    exportAllButton.innerHTML = `
      <svg width="20px" height="20px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M13 11L21.2 2.80005" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M22 6.8V2H17.2" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M11 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22H15C20 22 22 20 22 15V13" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    exportAllButton.addEventListener("click", () => {
      console.log('🚀 Clicked: Download ALL bookmarks');
      console.log('🌍 Current URL:', window.location.href);
      chrome.runtime.sendMessage({action: "download_all"}, (response) => {
        console.log('📨 Background response:', response);
      });
    });
    exportAllButton.style.position = "absolute";
    exportAllButton.style.width = "50px";
    exportAllButton.style.height = "50px";
    exportAllButton.style.right = "90px"; // 元のボタンより左に配置
    exportAllButton.style.display = "flex";
    exportAllButton.style.justifyContent = "center";
    exportAllButton.style.alignItems = "center";
    exportAllButton.style.cursor = "pointer";
    exportAllButton.style.backgroundColor = "#1d9bf0"; // 青色背景
    exportAllButton.style.borderRadius = "50%";
    exportAllButton.style.border = "2px solid #1a91da";
    exportAllButton.style.boxShadow = "0 2px 8px rgba(29, 155, 240, 0.3)";
    
    // 通常のエクスポートボタン
    let exportButton = document.createElement("div");
    exportButton.title = "エクスポート（標準）";
    exportButton.innerHTML = `
      <svg width="20px" height="20px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M13 11L21.2 2.80005" stroke="#292D32" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M22 6.8V2H17.2" stroke="#292D32" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M11 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22H15C20 22 22 20 22 15V13" stroke="#292D32" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    exportButton.addEventListener("click", () => {
      console.log('Clicked: Download bookmarks (standard)');
      chrome.runtime.sendMessage({action: "start_download"});
    });
    exportButton.style.position = "absolute";
    exportButton.style.width = "50px";
    exportButton.style.height = "50px";
    exportButton.style.right = "33px";
    exportButton.style.display = "flex";
    exportButton.style.justifyContent = "center";
    exportButton.style.alignItems = "center";
    exportButton.style.cursor = "pointer";
    exportButton.style.backgroundColor = "rgba(29, 155, 240, 0.1)";
    exportButton.style.borderRadius = "50%";
    exportButton.style.border = "2px solid #1d9bf0";
    
    targetElement.parentNode.insertBefore(exportAllButton, targetElement);
    targetElement.parentNode.insertBefore(exportButton, targetElement);
  });
}
