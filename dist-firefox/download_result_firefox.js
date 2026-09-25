let bookmarksData = [];
let accountInfo = null;
let autoDownloadTriggered = false;

function tryAutoDownload() {
    if (autoDownloadTriggered || bookmarksData.length === 0) return;
    browser.storage.local.get({autoDownloadFormat: 'none'}).then((settings) => {
        if (autoDownloadTriggered) return;
        const format = settings.autoDownloadFormat;
        if (format && format !== 'none') {
            autoDownloadTriggered = true;
            console.log(`⚡ 自動ダウンロード開始: ${format}`);
            downloadFile(format);
        }
    });
}

// Firefox専用 - browser APIのみを使用

// ページ読み込み時にデータを取得
window.addEventListener('load', () => {
    // URLパラメータから件数を取得
    const urlParams = new URLSearchParams(window.location.search);
    const count = urlParams.get('count');
    if (count) {
        document.getElementById('bookmarkCount').textContent = `${count}件`;
    }
    
    // 直接ストレージからデータを取得（Firefoxでは最も確実な方法）
    if (typeof browser !== 'undefined' && browser.storage) {
        console.log('🔄 Loading bookmarks from Firefox storage...');
        
        browser.storage.local.get(['bookmarks', 'accountInfo']).then((result) => {
            if (result.bookmarks) {
                try {
                    bookmarksData = JSON.parse(result.bookmarks);
                    document.getElementById('bookmarkCount').textContent = `${bookmarksData.length}件`;
                    console.log('✅ Bookmarks loaded from storage:', bookmarksData.length);
                    if (result.accountInfo) {
                        accountInfo = result.accountInfo;
                        console.log('👤 Account info loaded:', accountInfo);
                    }
                    tryAutoDownload();
                } catch (error) {
                    console.error('❌ Error parsing stored bookmarks:', error);
                }
            } else {
                console.error('❌ No bookmarks in storage');
            }
        }).catch((error) => {
            console.error('❌ Storage access error:', error);
        });
    } else {
        console.error('Firefox storage API not available');
    }
});

// ダウンロードボタンのイベントリスナーを設定
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('downloadJSON').addEventListener('click', () => downloadFile('json'));
    document.getElementById('downloadCSV').addEventListener('click', () => downloadFile('csv'));
    document.getElementById('downloadTXT').addEventListener('click', () => downloadFile('txt'));
    document.getElementById('downloadMarkdown').addEventListener('click', () => downloadFile('markdown'));
});

function downloadFile(format) {
    if (bookmarksData.length === 0) {
        alert('ダウンロードするデータがありません');
        return;
    }
    
    let content, filename, mimeType;
    
    switch (format) {
        case 'json':
            content = JSON.stringify(bookmarksData, null, 2);
            filename = `twitter_bookmarks_${new Date().toISOString().split('T')[0]}.json`;
            mimeType = 'application/json';
            break;
            
        case 'csv':
            content = convertToCSV(bookmarksData);
            filename = `twitter_bookmarks_${new Date().toISOString().split('T')[0]}.csv`;
            mimeType = 'text/csv';
            break;
            
        case 'txt':
            content = convertToText(bookmarksData);
            filename = `twitter_bookmarks_${new Date().toISOString().split('T')[0]}.txt`;
            mimeType = 'text/plain';
            break;
            
        case 'markdown':
            downloadMarkdownFiles(bookmarksData);
            return; // ZIP処理なので通常のダウンロードフローをスキップ
    }
    
    // Firefox用ダウンロード実行
    const blob = new Blob([content], { type: mimeType + ';charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    // 設定からフォルダ名を取得して自動保存
    browser.storage.local.get({downloadFolder: 'Twitter-Bookmarks', accountInfo: null}).then((settings) => {
        if (!accountInfo && settings.accountInfo) {
            accountInfo = settings.accountInfo;
            console.log('👤 Account info refreshed for download:', accountInfo);
        }
        const effectiveFolder = resolveDownloadFolder(settings.downloadFolder, accountInfo);
        const folderPath = effectiveFolder ? `${effectiveFolder}/${filename}` : filename;

        browser.downloads.download({
            url: url,
            filename: folderPath,
            saveAs: false // falseで自動保存、ダイアログを表示しない
        }).then((downloadId) => {
            console.log('✅ Download started successfully:', downloadId, 'to', folderPath);
            URL.revokeObjectURL(url);
        }).catch((error) => {
            console.error('❌ Download API failed:', error.message || error);
            // フォールバック: 従来の方法
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        });
    });
}

async function downloadMarkdownFiles(data) {
    console.log(`🔍 Starting Firefox Markdown export for ${data.length} items`);
    
    // 処理開始メッセージを表示
    showStatusMessage(`📝 Markdownファイルの生成を開始しています... (${data.length}件)`, 'processing');
    
    // データ構造の詳細分析
    let validTweetCount = 0;
    let hasLegacyCount = 0;
    let validTweetIds = [];
    let noLegacyTweets = [];
    
    data.forEach((item, index) => {
        if (item.content?.itemContent?.tweet_results?.result) {
            validTweetCount++;
            let tweet = item.content.itemContent.tweet_results.result;
            
            // TweetWithVisibilityResultsの場合、内部のtweetをチェック
            let actualTweet = tweet;
            if (tweet.__typename === 'TweetWithVisibilityResults' && tweet.tweet) {
                actualTweet = tweet.tweet;
            }
            
            if (actualTweet.legacy) {
                hasLegacyCount++;
            } else {
                // legacyデータがないツイートの詳細を記録
                const detailInfo = {
                    index: index,
                    tweetId: tweet.rest_id || 'no_id',
                    typename: tweet.__typename,
                    tombstone: tweet.tombstone,
                    unavailable_message: tweet.unavailable_message,
                    reason: tweet.reason || 'unknown',
                    keys: Object.keys(tweet)
                };
                
                // TweetWithVisibilityResultsの場合、内部構造を調査
                if (tweet.__typename === 'TweetWithVisibilityResults') {
                    detailInfo.innerTweet = tweet.tweet ? {
                        typename: tweet.tweet.__typename,
                        rest_id: tweet.tweet.rest_id,
                        hasLegacy: !!tweet.tweet.legacy,
                        keys: Object.keys(tweet.tweet)
                    } : null;
                    detailInfo.limitedActions = tweet.limitedActionResults;
                }
                
                noLegacyTweets.push(detailInfo);
            }
            if (actualTweet.rest_id) {
                validTweetIds.push(actualTweet.rest_id);
            }
        }
    });
    
    const uniqueTweetIds = new Set(validTweetIds);
    console.log(`📊 Firefox Data analysis:`);
    console.log(`  - Total items: ${data.length}`);
    console.log(`  - Valid tweet objects: ${validTweetCount}`);
    console.log(`  - With legacy data: ${hasLegacyCount}`);
    console.log(`  - Valid tweet IDs: ${validTweetIds.length}`);
    console.log(`  - Unique tweet IDs: ${uniqueTweetIds.size}`);
    
    // 設定を最初に一度だけ取得
    const storageSnapshot = await browser.storage.local.get({downloadFolder: 'Twitter-Bookmarks', accountInfo: null});
    if (!accountInfo && storageSnapshot.accountInfo) {
        accountInfo = storageSnapshot.accountInfo;
        console.log('👤 Account info refreshed for Markdown:', accountInfo);
    }
    const baseFolder = resolveDownloadFolder(storageSnapshot.downloadFolder, accountInfo);
    
    let fileCount = 0;
    const usedFilenames = new Set(); // 重複ファイル名を防ぐ
    const processedTweetIds = new Set(); // 処理済みツイートIDを追跡
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // 補助: ファイル名用のscreen_name抽出（多様なレスポンスに対応）
    function getScreenNameForFilename(itemForName) {
        const { userCore, userLegacy } = resolveUserEntitiesFromItem(itemForName);
        const sn = userLegacy.screen_name || userCore.screen_name;
        return (sn && typeof sn === 'string' && sn.length > 0) ? sn : 'unknown';
    }

    // 個別ファイルを連続ダウンロード
    for (let index = 0; index < data.length; index++) {
        const item = data[index];
        if (item.content && item.content.itemContent && item.content.itemContent.tweet_results) {
            let tweet = item.content.itemContent.tweet_results.result;
            
            // TweetWithVisibilityResultsの場合、内部のtweetを取得
            if (tweet && tweet.__typename === 'TweetWithVisibilityResults' && tweet.tweet) {
                tweet = tweet.tweet;
            }
            
            if (tweet && tweet.legacy) {
                const tweetId = tweet.rest_id || `tweet_${index + 1}`;
                
                // 重複処理チェック
                if (processedTweetIds.has(tweetId)) {
                    console.warn(`🔄 Skipping duplicate tweet ID: ${tweetId} at index ${index}`);
                    continue;
                }
                processedTweetIds.add(tweetId);
                
                const markdown = convertToMarkdown(item);
                
                // ユーザー名取得（堅牢化）
                let username = getScreenNameForFilename(item);
                
                // 一意のファイル名を生成（重複を防ぐ）
                let baseFilename = `@${username}_${tweetId}`;
                let filename = `${baseFilename}.md`;
                let counter = 1;
                
                while (usedFilenames.has(filename)) {
                    filename = `${baseFilename}_${counter}.md`;
                    counter++;
                }
                usedFilenames.add(filename);
                
                const folderPath = baseFolder ? `${baseFolder}/markdown/${filename}` : `markdown/${filename}`;
                
                // Firefox版 - 自動保存設定を適用
                const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                
                // folderPathは上で既に定義済み
                
                try {
                    const downloadId = await browser.downloads.download({
                        url: url,
                        filename: folderPath,
                        saveAs: false // falseで自動保存
                    });
                    fileCount++;
                    console.log(`📝 Downloaded ${fileCount}/${data.length}: ${filename}`);
                    
                    // URLの解放を遅延（ダウンロードが完了するまで待つ）
                    setTimeout(() => {
                        URL.revokeObjectURL(url);
                    }, 2000);
                } catch (error) {
                    console.error('❌ Download failed:', error.message || error);
                    
                    // エラーの詳細を記録
                    if (error.message && error.message.includes('canceled')) {
                        console.error('⚠️ Download was canceled - URL may have been revoked too early');
                    }
                    
                    // フォールバック: 新しいBlobを作成してリトライ
                    try {
                        const newBlob = new Blob([markdown], { type: 'text/markdown;charset=utf-8;' });
                        const newUrl = URL.createObjectURL(newBlob);
                        
                        const link = document.createElement('a');
                        link.href = newUrl;
                        link.download = filename;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        
                        // フォールバックのURLも遅延解放
                        setTimeout(() => {
                            URL.revokeObjectURL(newUrl);
                        }, 2000);
                        
                        fileCount++;
                        console.log(`📝 Downloaded via fallback ${fileCount}/${data.length}: ${filename}`);
                    } catch (fallbackError) {
                        console.error('❌ Fallback download also failed:', fallbackError);
                        showStatusMessage(`⚠️ ダウンロード失敗: ${filename}`, 'warning');
                    }
                }
                
                // ブラウザが詰まらないよう待機（遅延を調整）
                if (index % 5 === 4) { // 5ファイルごとに長めの休憩
                    await delay(500);
                } else {
                    await delay(100); // 通常の待機時間を少し増やす
                }
            }
        }
    }
    
    console.log(`✅ Firefox Markdown export completed:`);
    console.log(`  - Items processed: ${data.length}`);
    console.log(`  - Files created: ${fileCount}`);
    console.log(`  - Expected files (with legacy): ${hasLegacyCount}`);
    console.log(`  - Unique tweet IDs: ${uniqueTweetIds.size}`);
    
    // 完了メッセージを表示
    showStatusMessage(`✅ ${fileCount}個のMarkdownファイルが生成されました！`, 'success');
}

function showStatusMessage(message, type = 'info') {
    const statusElement = document.getElementById('statusMessage');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.className = `status-message ${type}`;
        statusElement.style.display = 'block';
        
        // 成功メッセージは5秒後に非表示
        if (type === 'success') {
            setTimeout(() => {
                statusElement.style.display = 'none';
            }, 5000);
        }
    }
}
