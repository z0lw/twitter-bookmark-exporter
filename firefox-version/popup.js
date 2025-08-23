// Firefox版ポップアップ - browser APIを使用

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    setupEventListeners();
});

function loadSettings() {
    // Firefoxのbrowser APIを使用
    browser.storage.local.get({
        countLimit: 'all',
        customCount: 2000,
        dateLimit: 'all',
        customDate: getDefaultDate(),
        downloadFolder: 'Twitter-Bookmarks',
        lastExportTimestamp: null
    }).then((settings) => {
        console.log('📋 Firefox settings loaded:', settings);
        
        // 件数制限の復元
        document.querySelector(`input[name="count_limit"][value="${settings.countLimit}"]`).checked = true;
        document.getElementById('custom_count').value = settings.customCount;
        
        // 期間制限の復元
        document.querySelector(`input[name="date_limit"][value="${settings.dateLimit}"]`).checked = true;
        document.getElementById('custom_date').value = settings.customDate;
        
        // ダウンロードフォルダの復元
        document.getElementById('download_folder').value = settings.downloadFolder;
        
        // 前回エクスポート日時の表示
        if (settings.lastExportTimestamp) {
            const lastDate = new Date(settings.lastExportTimestamp);
            const displayDate = lastDate.toLocaleString('ja-JP', {
                timeZone: 'Asia/Tokyo',
                year: 'numeric',
                month: '2-digit', 
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            document.getElementById('last_export_info').textContent = `前回: ${displayDate}`;
            document.getElementById('last_export_info').style.display = 'block';
        }
        
        updateInputStates();
    }).catch((error) => {
        console.error('❌ Failed to load settings:', error);
        // デフォルト値で初期化
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
    
    // フォルダ名の検証
    if (downloadFolder && !/^[a-zA-Z0-9_\-\s\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]+$/.test(downloadFolder)) {
        showStatus('フォルダ名に無効な文字が含まれています', 'error');
        return;
    }
    
    // 設定を保存してからダウンロード開始
    const settingsToSave = {
        countLimit: countLimit,
        customCount: customCount,
        dateLimit: dateLimit,
        customDate: customDate,
        downloadFolder: downloadFolder || 'Twitter-Bookmarks'
    };
    
    console.log('💾 Saving settings:', settingsToSave);
    
    // Firefox用: storage.localを使用
    browser.storage.local.set(settingsToSave).then(() => {
        console.log('✅ Settings saved');
        showStatus('設定を保存しました。ダウンロードを開始します...', 'success');
        
        // ボタンを無効化
        const startBtn = document.getElementById('startBtn');
        startBtn.disabled = true;
        startBtn.textContent = '📥 開始中...';
        
        // バックグラウンドスクリプトにメッセージ送信
        return browser.runtime.sendMessage({action: "popup_download_all"});
    }).then((response) => {
        console.log('✅ Message sent, response:', response);
        // ポップアップを閉じる
        window.close();
    }).catch((error) => {
        console.error('❌ Error:', error);
        showStatus('エラーが発生しました: ' + error.message, 'error');
        const startBtn = document.getElementById('startBtn');
        startBtn.disabled = false;
        startBtn.textContent = '📥 取得を開始';
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