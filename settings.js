// 設定画面のJavaScript

// ページ読み込み時に保存された設定を復元
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    setupEventListeners();
});

function loadSettings() {
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
    
    // 保存ボタン
    document.getElementById('saveBtn').addEventListener('click', saveSettings);
}

function updateInputStates() {
    // カスタム件数の入力フィールドの有効/無効
    const customCountChecked = document.getElementById('count_custom').checked;
    document.getElementById('custom_count').disabled = !customCountChecked;
    
    // カスタム日付の入力フィールドの有効/無効
    const customDateChecked = document.getElementById('date_custom').checked;
    document.getElementById('custom_date').disabled = !customDateChecked;
}

function saveSettings() {
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
    
    // 設定を保存
    chrome.storage.sync.set({
        countLimit: countLimit,
        customCount: customCount,
        dateLimit: dateLimit,
        customDate: customDate
    }, () => {
        showStatus('設定が保存されました！', 'success');
    });
}

function showStatus(message, type) {
    const statusElement = document.getElementById('statusMessage');
    statusElement.textContent = message;
    statusElement.className = `status-message ${type === 'success' ? 'status-success' : 'status-error'}`;
    statusElement.style.display = 'block';
    
    setTimeout(() => {
        statusElement.style.display = 'none';
    }, 3000);
}

function getDefaultDate() {
    // デフォルトは1ヶ月前
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return date.toISOString().split('T')[0];
}

// 日付からsortIndexを計算する関数（Twitter のsortIndex形式）
function dateToSortIndex(dateString) {
    const date = new Date(dateString);
    const timestamp = date.getTime();
    // TwitterのsortIndexは（タイムスタンプ << 20）+ ランダム値
    return (BigInt(timestamp) << BigInt(20)).toString();
}

// sortIndexから日付を復元する関数
function sortIndexToDate(sortIndex) {
    const timestamp = Number(BigInt(sortIndex) >> BigInt(20));
    return new Date(timestamp);
}