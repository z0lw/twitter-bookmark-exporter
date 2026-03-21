// ポップアップのJavaScript

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    setupEventListeners();
});

function computeAccountKey(info) {
    if (!info) return null;
    if (info.userId) {
        return `id:${info.userId}`;
    }
    if (info.screenName) {
        return `sn:${info.screenName.toLowerCase()}`;
    }
    return null;
}

function showLastExport(timestamp) {
    const infoElement = document.getElementById('last_export_info');
    if (!timestamp) {
        infoElement.style.display = 'none';
        return;
    }
    const lastDate = new Date(timestamp);
    const displayDate = lastDate.toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit', 
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    infoElement.textContent = `前回: ${displayDate}`;
    infoElement.style.display = 'block';
}

function loadSettings() {
    // アクティブなx.comタブから最新のアカウント情報を取得
    chrome.tabs.query({url: ["https://twitter.com/*", "https://x.com/*"]}, (tabs) => {
        let freshAccountPromise;
        if (tabs && tabs.length > 0) {
            freshAccountPromise = new Promise((resolve) => {
                chrome.tabs.sendMessage(tabs[0].id, {action: "get_fresh_account_info"}, (response) => {
                    if (chrome.runtime.lastError || !response) {
                        resolve(null);
                    } else {
                        resolve(response.accountInfo);
                    }
                });
            });
        } else {
            freshAccountPromise = Promise.resolve(null);
        }

        freshAccountPromise.then((freshAccount) => {
            let runtimeAccount = freshAccount;
            if (!runtimeAccount) {
                // フォールバック: backgroundのメモリから取得
                return new Promise((resolve) => {
                    chrome.runtime.sendMessage({action: "get_account_info"}, (response) => {
                        if (!chrome.runtime.lastError && response && response.accountInfo) {
                            runtimeAccount = response.accountInfo;
                        }
                        resolve(runtimeAccount);
                    });
                });
            }
            return runtimeAccount;
        }).then((runtimeAccount) => {

        chrome.storage.sync.get({
            countLimit: 'since_last_export',
            customCount: 2000,
            dateLimit: 'all',
            customDate: getDefaultDate(),
            downloadFolder: 'Twitter-Bookmarks',
            autoDownloadFormat: 'none',
            lastExportTimestamp: null,
            lastExportTimestampMap: {}
        }, (settings) => {
            // 件数制限の復元
            document.querySelector(`input[name="count_limit"][value="${settings.countLimit}"]`).checked = true;
            document.getElementById('custom_count').value = settings.customCount;

            // 期間制限の復元
            document.querySelector(`input[name="date_limit"][value="${settings.dateLimit}"]`).checked = true;
            document.getElementById('custom_date').value = settings.customDate;

            // ダウンロードフォルダの復元
            document.getElementById('download_folder').value = settings.downloadFolder;

            // 自動ダウンロード形式の復元
            document.getElementById('auto_download_format').value = settings.autoDownloadFormat;
            
            chrome.storage.local.get(['accountInfo'], (localData) => {
                const accountInfo = runtimeAccount || localData.accountInfo || null;
                const map = settings.lastExportTimestampMap || {};
                const key = computeAccountKey(accountInfo);
                let timestamp = null;
                if (key && map[key]) {
                    timestamp = map[key];
                } else if (settings.lastExportTimestamp) {
                    timestamp = settings.lastExportTimestamp;
                }
                showLastExport(timestamp);
            });

            updateInputStates();
        });

        }); // freshAccountPromise.then
    }); // chrome.tabs.query
}

function setupEventListeners() {
    // ラジオボタンの状態変更
    document.querySelectorAll('input[name="count_limit"]').forEach(radio => {
        radio.addEventListener('change', updateInputStates);
    });
    
    document.querySelectorAll('input[name="date_limit"]').forEach(radio => {
        radio.addEventListener('change', updateInputStates);
    });
    
    // 開始ボタン
    document.getElementById('startBtn').addEventListener('click', startDownload);
}

function updateInputStates() {
    // カスタム件数の入力フィールドの有効/無効
    const customCountChecked = document.getElementById('count_custom').checked;
    document.getElementById('custom_count').disabled = !customCountChecked;
    
    // カスタム日付の入力フィールドの有効/無効
    const customDateChecked = document.getElementById('date_custom').checked;
    document.getElementById('custom_date').disabled = !customDateChecked;
}

function startDownload() {
    const countLimit = document.querySelector('input[name="count_limit"]:checked').value;
    const customCount = parseInt(document.getElementById('custom_count').value);
    const dateLimit = document.querySelector('input[name="date_limit"]:checked').value;
    const customDate = document.getElementById('custom_date').value;
    const downloadFolder = document.getElementById('download_folder').value.trim();
    
    // バリデーション
    if (countLimit === 'custom' && (isNaN(customCount) || customCount < 1 || customCount > 10000)) {
        showStatus('カスタム件数は1〜10000の範囲で入力してください', 'error');
        return;
    }
    
    if (dateLimit === 'custom' && !customDate) {
        showStatus('カスタム日付を選択してください', 'error');
        return;
    }

    // 前回エクスポート以降の全件を選択した場合、記録があるかチェック
    if (countLimit === 'since_last_export') {
        const hasLastExport = document.getElementById('last_export_info').style.display !== 'none';
        if (!hasLastExport) {
            showStatus('前回エクスポートの記録がありません。初回は他のオプションを使用してください。', 'error');
            return;
        }
    }
    
    // フォルダ名の検証
    if (downloadFolder && !/^[a-zA-Z0-9_\-\s\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]+$/.test(downloadFolder)) {
        showStatus('フォルダ名に無効な文字が含まれています', 'error');
        return;
    }
    
    const autoDownloadFormat = document.getElementById('auto_download_format').value;

    // 設定を保存してからダウンロード開始
    const settingsToSave = {
        countLimit: countLimit,
        customCount: customCount,
        dateLimit: dateLimit,
        customDate: customDate,
        downloadFolder: downloadFolder || 'Twitter-Bookmarks',
        autoDownloadFormat: autoDownloadFormat
    };
    console.log('💾 Saving settings:', settingsToSave);
    chrome.storage.sync.set(settingsToSave, () => {
        // ダウンロード開始
        showStatus('設定を保存しました。ダウンロードを開始します...', 'success');
        
        // ボタンを無効化
        const startBtn = document.getElementById('startBtn');
        startBtn.disabled = true;
        startBtn.textContent = '📥 開始中...';
        
        // バックグラウンドスクリプトにダウンロード開始を要求
        chrome.runtime.sendMessage({action: "popup_download_all"}, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Runtime error:', chrome.runtime.lastError);
                showStatus('エラーが発生しました', 'error');
                startBtn.disabled = false;
                startBtn.textContent = '📥 取得を開始';
            } else {
                // ポップアップを閉じる
                window.close();
            }
        });
    });
}

function showStatus(message, type) {
    const statusElement = document.getElementById('status');
    statusElement.textContent = message;
    statusElement.className = `status ${type}`;
    statusElement.style.display = 'block';
    
    if (type === 'success') {
        setTimeout(() => {
            statusElement.style.display = 'none';
        }, 2000);
    }
}

function getDefaultDate() {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return date.toISOString().split('T')[0];
}
