// ポップアップのJavaScript

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    setupEventListeners();
});

function loadSettings() {
    // 保存された設定を読み込み
    chrome.storage.sync.get({
        countLimit: 'all',
        customCount: 2000,
        dateLimit: 'all',
        customDate: getDefaultDate()
    }, (settings) => {
        // 件数制限の復元
        document.querySelector(`input[name="count_limit"][value="${settings.countLimit}"]`).checked = true;
        document.getElementById('custom_count').value = settings.customCount;
        
        // 期間制限の復元
        document.querySelector(`input[name="date_limit"][value="${settings.dateLimit}"]`).checked = true;
        document.getElementById('custom_date').value = settings.customDate;
        
        updateInputStates();
    });
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
    
    // 設定リンク
    document.getElementById('settingsLink').addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
    });
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
    
    // バリデーション
    if (countLimit === 'custom' && (isNaN(customCount) || customCount < 1 || customCount > 10000)) {
        showStatus('カスタム件数は1〜10000の範囲で入力してください', 'error');
        return;
    }
    
    if (dateLimit === 'custom' && !customDate) {
        showStatus('カスタム日付を選択してください', 'error');
        return;
    }
    
    // 設定を保存してからダウンロード開始
    const settingsToSave = {
        countLimit: countLimit,
        customCount: customCount,
        dateLimit: dateLimit,
        customDate: customDate
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