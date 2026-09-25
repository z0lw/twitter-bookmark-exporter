// ローカル版 Twitter Bookmarks Export Content Script
// 全件出力対応、外部サービス通信を削除

console.log('🔍 Content script loaded on:', window.location.href);

function getBookmarkTimeline(response) {
  return response?.data?.bookmark_timeline_v2 || response?.data?.bookmark_collection_timeline;
}

function getBookmarkEntries(response) {
  return getBookmarkTimeline(response)?.timeline?.instructions?.flatMap(
    instruction => instruction.entries || (instruction.entry ? [instruction.entry] : [])
  ) || [];
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const sanitize = (value) => String(value).replace(/[^a-zA-Z0-9_\-]/g, '');

function getAccountFingerprint(info) {
  if (!info) return 'null';
  return `${info.userId || ''}|${info.screenName || ''}`;
}

let lastSentAccountFingerprint = null;

function extractAccountInfo() {
  const info = {};
  let hasInfo = false;
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

function sendAccountInfo(force = false) {
  const info = extractAccountInfo();
  const fingerprint = getAccountFingerprint(info);
  if (!force && fingerprint === lastSentAccountFingerprint) {
    return;
  }
  lastSentAccountFingerprint = fingerprint;
  chrome.runtime.sendMessage({action: "set_account_info", accountInfo: info || null});
}

// ページ読込時にもアカウント情報を通知
sendAccountInfo(true);

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === "iconClicked") sendResponse({started: true});
  handleContentMessage(message, sender, sendResponse).catch(error => {
    console.error('Bookmark export failed:', error);
  });
  return message.action === "get_fresh_account_info";
});

async function handleContentMessage(message, sender, sendResponse) {
  let overlay;
  console.log('📧 Content script received message:', message.action);
  
  if (message.action === "iconClicked") {
    sendAccountInfo(true);
    console.log('🎯 Processing iconClicked with bookmarksURL:', message.bookmarksURL);
    const stopCondition = message.stopCondition;
    const config = message.otherConfig || {};
    let cursor = null;
    let totalCount = 0;
    let complete = true;
    const seenCursors = new Set();

    // ローディングオーバーレイ作成
    overlay = document.createElement("div");
    overlay.dataset.bookmarkExportOverlay = 'true';
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

    window.forceStopDownload = false;
    let failures = 0;
    while (!window.forceStopDownload) {
      let response;
      try {
        response = await fetchBookmarkPage(cursor, message.creds, message.bookmarksURL);
        if (response?.errors?.length && !getBookmarkEntries(response).length) {
          throw new Error(response.errors.map(error => error.message || String(error)).join('; '));
        }
        failures = 0;
      } catch (error) {
        failures++;
        chrome.runtime.sendMessage({action: "fetch_network_error", error: String(error)});
        if (failures < 3) {
          await delay(1000 * (2 ** (failures - 1)));
          continue;
        }
        complete = false;
        statusText.textContent = "取得を中断しました（" + totalCount + "件）。一部を保存するか選択してください。";
        if (!confirm("取得に失敗しました: " + (error.message || error) + "\\n取得済みの" + totalCount + "件を保存しますか？")) {
          chrome.runtime.sendMessage({action: "abort"});
          overlay.remove();
          return;
        }
        break;
      }

      const entries = getBookmarkEntries(response);
      const bookmarkEntries = entries.filter(entry => entry?.entryId && !entry.entryId.startsWith("cursor-"));
      const nextCursor = entries.find(entry => entry?.entryId?.startsWith("cursor-bottom-"))?.content?.value;
      if (response?.errors?.length) {
        chrome.runtime.sendMessage({action: "partial_fetch_error", errors: response.errors});
      }
      if (!entries.length && !cursor) {
        complete = false;
        chrome.runtime.sendMessage({action: "fetch_network_error", error: "Bookmark timeline was missing from the first response"});
        statusText.textContent = "ブックマークを取得できませんでした。";
        chrome.runtime.sendMessage({action: "abort"});
        overlay.remove();
        return;
      }

      let shouldStop = false;
      if (bookmarkEntries.length) {
        try {
          const result = await chrome.runtime.sendMessage({action: "fetch_page", page: response});
          if (result?.error) throw new Error(result.error);
          totalCount = result?.count ?? totalCount + bookmarkEntries.length;
          shouldStop = result?.stop === true;
        } catch (error) {
          complete = false;
          statusText.textContent = "保存に失敗しました（" + totalCount + "件）。";
          chrome.runtime.sendMessage({action: "fetch_network_error", error: String(error)});
          break;
        }
      }
      statusText.textContent = "全件ダウンロード中... " + totalCount + "件取得済み";

      if (shouldStop || window.forceStopDownload || (stopCondition?.type === "count" && totalCount >= stopCondition.value)) break;
      if (!nextCursor || seenCursors.has(nextCursor)) {
        if (nextCursor && seenCursors.has(nextCursor)) complete = false;
        break;
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
      await delay(Math.max(50, Math.min(config.wait_interval_ms || 100, 10000)));
    }

    await chrome.runtime.sendMessage({action: "finish_download", complete});
    overlay.remove();

  } else if (message.action === "abortConfirm") {
    if (confirm("現在のダウンロード処理を停止しますか？")) {
      chrome.runtime.sendMessage({action: "abort"});
      window.forceStopDownload = true;
      document.querySelector('[data-bookmark-export-overlay]')?.remove();
    }
  } else if (message.action === "selectAllBookmarks") {
    document.querySelector('a[href="/i/history/all"], a[href="/i/bookmarks/all"]')?.click();
  } else if (message.action === "get_fresh_account_info") {
    const info = extractAccountInfo();
    sendAccountInfo(true);
    sendResponse({accountInfo: info});
    return true;
  } else if (message.action === "stop_download") {
    console.log('🛑 Received stop signal from background:', message.reason);
    // グローバル変数でダウンロード停止フラグを設定
    window.forceStopDownload = true;
    window.stopReason = message.reason;
  }
}

// ヘルパー関数
async function fetchBookmarkPage(cursor, credentials, bookmarksURL) {
  const url = new URL(bookmarksURL);
  const variables = JSON.parse(url.searchParams.get('variables') || '{}');
  if (cursor) variables.cursor = cursor;
  else delete variables.cursor;
  url.searchParams.set('variables', JSON.stringify(variables));

  const response = await fetch(url.toString(), {
    headers: {
      "accept": "*/*",
      "authorization": credentials.authorization,
      "x-csrf-token": credentials["x-csrf-token"],
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type": "OAuth2Session"
    },
    method: "GET",
    credentials: "include"
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json();
}

// X の履歴ヘッダーは SPA 遷移で作り直されるため、表示されるたびにボタンを確認する。
let exportButtonCheckScheduled = false;
function ensureExportButtons() {
  exportButtonCheckScheduled = false;
  if (!/^\/i\/(?:history|bookmarks)(?:\/|$)/.test(location.pathname)) return;
  const searchButton = document.querySelector(
    '[data-testid="primaryColumn"] button[aria-label="ブックマークを検索"], [data-testid="primaryColumn"] button[aria-label="Search Bookmarks"]'
  );
  const container = searchButton?.parentElement?.parentElement;
  if (!container || container.querySelector('[data-bookmark-export-button]')) return;

  for (const [label, action, color] of [
    ['全件エクスポート', 'download_all', '#1d9bf0'],
    ['エクスポート', 'start_download', 'transparent']
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.bookmarkExportButton = action;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.textContent = action === 'download_all' ? '⇧' : '↗';
    button.style.cssText = 'width:32px;height:32px;margin-right:6px;border:1px solid #1d9bf0;border-radius:50%;color:white;background:' + color + ';cursor:pointer;font-size:20px;';
    button.addEventListener('click', () => chrome.runtime.sendMessage({action}));
    container.insertBefore(button, searchButton.parentElement);
  }
}
function scheduleExportButtonCheck() {
  if (exportButtonCheckScheduled) return;
  exportButtonCheckScheduled = true;
  requestAnimationFrame(ensureExportButtons);
}
new MutationObserver(scheduleExportButtonCheck).observe(document.documentElement, {childList: true, subtree: true});
scheduleExportButtonCheck();
