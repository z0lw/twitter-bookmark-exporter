let bookmarksData = [];
let accountInfo = null;
let autoDownloadTriggered = false;

function tryAutoDownload() {
    if (autoDownloadTriggered || bookmarksData.length === 0) return;
    chrome.storage.sync.get({autoDownloadFormat: 'none'}, (settings) => {
        if (autoDownloadTriggered) return;
        const format = settings.autoDownloadFormat;
        if (format && format !== 'none') {
            autoDownloadTriggered = true;
            console.log(`⚡ 自動ダウンロード開始: ${format}`);
            downloadFile(format);
        }
    });
}

// ページ読み込み時にデータを取得
window.addEventListener('load', () => {
    // URLパラメータから件数を取得
    const urlParams = new URLSearchParams(window.location.search);
    const count = urlParams.get('count');
    if (count) {
        document.getElementById('bookmarkCount').textContent = `${count}件`;
    }
    
    // Background scriptからデータを要求
    if (typeof chrome !== 'undefined' && chrome.runtime) {
        console.log('🔄 Requesting bookmarks from background...');
        
        // タイムアウト付きでリクエスト
        const timeout = setTimeout(() => {
            console.error('❌ Request timeout - trying direct storage access');
            // フォールバック: 直接ストレージにアクセス
            chrome.storage.local.get(['bookmarks', 'accountInfo'], (result) => {
                if (result.bookmarks) {
                    try {
                        bookmarksData = JSON.parse(result.bookmarks);
                        document.getElementById('bookmarkCount').textContent = `${bookmarksData.length}件`;
                        console.log('✅ Bookmarks loaded via direct storage:', bookmarksData.length);
                        if (result.accountInfo) {
                            accountInfo = result.accountInfo;
                            console.log('👤 Account info (fallback):', accountInfo);
                        }
                        tryAutoDownload();
                    } catch (error) {
                        console.error('❌ Error parsing stored bookmarks:', error);
                    }
                }
            });
        }, 5000);

        chrome.runtime.sendMessage({action: 'get_bookmarks'}, (response) => {
            clearTimeout(timeout);
            console.log('📥 Background response:', response);
            
            if (chrome.runtime.lastError) {
                console.error('Chrome runtime error:', chrome.runtime.lastError);
                // フォールバック: 直接ストレージアクセス
                chrome.storage.local.get(['bookmarks', 'accountInfo'], (result) => {
                    if (result.bookmarks) {
                        try {
                            bookmarksData = JSON.parse(result.bookmarks);
                            document.getElementById('bookmarkCount').textContent = `${bookmarksData.length}件`;
                            console.log('✅ Bookmarks loaded via fallback:', bookmarksData.length);
                            if (result.accountInfo) {
                                accountInfo = result.accountInfo;
                                console.log('👤 Account info (fallback runtime error):', accountInfo);
                            }
                            tryAutoDownload();
                        } catch (error) {
                            console.error('❌ Error parsing fallback bookmarks:', error);
                        }
                    }
                });
                return;
            }
            
            if (response && response.bookmarks) {
                try {
                    console.log('📄 Raw bookmarks data length:', response.bookmarks.length);
                    bookmarksData = JSON.parse(response.bookmarks);
                    document.getElementById('bookmarkCount').textContent = `${bookmarksData.length}件`;
                    console.log('✅ Bookmarks loaded successfully:', bookmarksData.length);
                    if (response.accountInfo) {
                        accountInfo = response.accountInfo;
                        console.log('👤 Account info received:', accountInfo);
                    }
                    tryAutoDownload();
                } catch (error) {
                    console.error('❌ Error parsing bookmarks:', error);
                    console.log('Raw data:', response.bookmarks.substring(0, 100));
                }
            } else if (response && response.error) {
                console.error('❌ Background error:', response.error);
            } else {
                console.error('❌ No bookmarks data received from background');
                console.log('Response was:', response);
            }
        });
    } else {
        console.error('Chrome runtime API not available');
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
    
    // ダウンロード実行 (downloads API使用でユーザー設定フォルダに保存)
    const blob = new Blob([content], { type: mimeType + ';charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    // 設定からフォルダ名を取得
    chrome.storage.sync.get({downloadFolder: 'Twitter-Bookmarks'}, (settings) => {
        chrome.storage.local.get(['accountInfo'], (localData) => {
            if (!accountInfo && localData.accountInfo) {
                accountInfo = localData.accountInfo;
                console.log('👤 Account info refreshed for download:', accountInfo);
            }

            const effectiveFolder = resolveDownloadFolder(settings.downloadFolder, accountInfo);
            const folderPath = effectiveFolder ? `${effectiveFolder}/${filename}` : filename;
            
            chrome.downloads.download({
                url: url,
                filename: folderPath,
                saveAs: false // trueにすると保存ダイアログが表示される
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error('Download error:', chrome.runtime.lastError);
                    // フォールバック: 従来の方法
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = filename;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                }
                URL.revokeObjectURL(url);
            });
        });
    });
}

async function downloadMarkdownFiles(data) {
    console.log(`🔍 Starting Markdown export for ${data.length} items`);
    
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
    console.log(`📊 Data analysis:`);
    console.log(`  - Total items: ${data.length}`);
    console.log(`  - Valid tweet objects: ${validTweetCount}`);
    console.log(`  - With legacy data: ${hasLegacyCount}`);
    console.log(`  - Valid tweet IDs: ${validTweetIds.length}`);
    console.log(`  - Unique tweet IDs: ${uniqueTweetIds.size}`);
    
    if (validTweetIds.length !== uniqueTweetIds.size) {
        console.warn(`⚠️ Duplicate tweet IDs detected! ${validTweetIds.length - uniqueTweetIds.size} duplicates found`);
        
        // 重複IDを表示
        const duplicates = validTweetIds.filter((id, index) => validTweetIds.indexOf(id) !== index);
        console.log('Duplicate IDs:', [...new Set(duplicates)]);
    }
    
    // legacyデータがないツイートの詳細を表示
    if (noLegacyTweets.length > 0) {
        console.warn(`⚠️ ${noLegacyTweets.length} tweets without legacy data found:`);
        noLegacyTweets.forEach((tweet, i) => {
            console.log(`${i + 1}. Index ${tweet.index}: ${tweet.tweetId}`);
            console.log(`   Type: ${tweet.typename}`);
            console.log(`   Reason: ${tweet.reason}`);
            console.log(`   Available keys: ${tweet.keys.join(', ')}`);
            
            if (tweet.innerTweet) {
                console.log(`   Inner tweet: ${tweet.innerTweet.typename} (ID: ${tweet.innerTweet.rest_id})`);
                console.log(`   Inner has legacy: ${tweet.innerTweet.hasLegacy}`);
                console.log(`   Inner keys: ${tweet.innerTweet.keys.join(', ')}`);
            }
            
            if (tweet.limitedActions) {
                console.log(`   Limited actions: ${JSON.stringify(tweet.limitedActions)}`);
            }
            
            if (tweet.tombstone) {
                console.log(`   Tombstone: ${JSON.stringify(tweet.tombstone)}`);
            }
            if (tweet.unavailable_message) {
                console.log(`   Unavailable: ${JSON.stringify(tweet.unavailable_message)}`);
            }
        });
    }
    
    // 設定を最初に一度だけ取得
    const settings = await new Promise((resolve) => {
        chrome.storage.sync.get({downloadFolder: 'Twitter-Bookmarks'}, resolve);
    });
    const localAccountData = await new Promise((resolve) => {
        chrome.storage.local.get(['accountInfo'], resolve);
    });
    if (!accountInfo && localAccountData.accountInfo) {
        accountInfo = localAccountData.accountInfo;
        console.log('👤 Account info refreshed for Markdown:', accountInfo);
    }
    const baseFolder = resolveDownloadFolder(settings.downloadFolder, accountInfo);
    
    let fileCount = 0;
    const usedFilenames = new Set(); // 重複ファイル名を防ぐ
    const processedTweetIds = new Set(); // 処理済みツイートIDを追跡
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // 補助: ファイル名用のscreen_name抽出（多様なレスポンス形に対応）
    function getScreenNameForFilename(itemForName) {
        const { userCore, userLegacy } = resolveUserEntitiesFromItem(itemForName);
        const sn = userLegacy.screen_name || userCore.screen_name;
        if (sn && typeof sn === 'string' && sn.length > 0) {
            return sn;
        }
        return 'unknown';
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
                
                // Promise化されたダウンロード処理
                await new Promise((resolve, reject) => {
                    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    
                    chrome.downloads.download({
                        url: url,
                        filename: folderPath,
                        saveAs: false
                    }, (downloadId) => {
                        if (chrome.runtime.lastError) {
                            console.warn(`Download API failed for ${filename}, using fallback:`, chrome.runtime.lastError.message);
                            // フォールバック: 従来の方法
                            const link = document.createElement('a');
                            link.href = url;
                            link.download = filename;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                        }
                        
                        // URL解放を少し遅延させる
                        setTimeout(() => {
                            URL.revokeObjectURL(url);
                        }, 500);
                        
                        resolve();
                    });
                });
                
                fileCount++;
                console.log(`📝 Downloaded ${fileCount}/${data.length}: ${filename}`);
                
                // ブラウザが詰まらないよう待機（遅延を短縮）
                if (index % 10 === 9) { // 10ファイルごとに少し休憩
                    await delay(300);
                } else {
                    await delay(50);
                }
            }
        }
    }
    
    console.log(`✅ Markdown export completed:`);
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
