let bookmarksData = [];

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
            chrome.storage.local.get(['bookmarks'], (result) => {
                if (result.bookmarks) {
                    try {
                        bookmarksData = JSON.parse(result.bookmarks);
                        document.getElementById('bookmarkCount').textContent = `${bookmarksData.length}件`;
                        console.log('✅ Bookmarks loaded via direct storage:', bookmarksData.length);
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
                chrome.storage.local.get(['bookmarks'], (result) => {
                    if (result.bookmarks) {
                        try {
                            bookmarksData = JSON.parse(result.bookmarks);
                            document.getElementById('bookmarkCount').textContent = `${bookmarksData.length}件`;
                            console.log('✅ Bookmarks loaded via fallback:', bookmarksData.length);
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
        const folderPath = settings.downloadFolder ? `${settings.downloadFolder}/${filename}` : filename;
        
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
}

function convertToCSV(data) {
    const headers = ['日付', 'ユーザー名', 'ユーザーID', 'ツイート内容', 'いいね数', 'RT数', 'URL'];
    const rows = [headers.join(',')];
    
    data.forEach(item => {
        if (item.content && item.content.itemContent && item.content.itemContent.tweet_results) {
            const tweet = item.content.itemContent.tweet_results.result;
            if (tweet && tweet.legacy) {
                const legacy = tweet.legacy;
                let userCore = {};
                if (tweet.core?.user_results?.result?.core) {
                    userCore = tweet.core.user_results.result.core;
                }
                
                // テキスト取得: is_expandable=true の場合は note_tweet のテキストを使用
                let tweetText = legacy.full_text || '';
                if (tweet.note_tweet?.is_expandable && tweet.note_tweet?.note_tweet_results?.result?.text) {
                    tweetText = tweet.note_tweet.note_tweet_results.result.text;
                }
                
                const row = [
                    `"${new Date(legacy.created_at).toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'})}"`,
                    `"${(userCore.name || '').replace(/"/g, '""')}"`,
                    `"${userCore.screen_name || ''}"`,
                    `"${tweetText.replace(/"/g, '""').replace(/\n/g, ' ')}"`,
                    legacy.favorite_count || 0,
                    legacy.retweet_count || 0,
                    `"https://x.com/${userCore.screen_name}/status/${legacy.id_str}"`
                ];
                rows.push(row.join(','));
            }
        }
    });
    
    return rows.join('\n');
}

function convertToText(data) {
    let text = `Twitter ブックマークエクスポート\n`;
    text += `出力日時: ${new Date().toLocaleString('ja-JP')}\n`;
    text += `総件数: ${data.length}件\n`;
    text += `=`.repeat(50) + '\n\n';
    
    data.forEach((item, index) => {
        if (item.content && item.content.itemContent && item.content.itemContent.tweet_results) {
            const tweet = item.content.itemContent.tweet_results.result;
            if (tweet && tweet.legacy) {
                const legacy = tweet.legacy;
                let userCore = {};
                if (tweet.core?.user_results?.result?.core) {
                    userCore = tweet.core.user_results.result.core;
                }
                
                // テキスト取得: is_expandable=true の場合は note_tweet のテキストを使用
                let tweetText = legacy.full_text || '';
                if (tweet.note_tweet?.is_expandable && tweet.note_tweet?.note_tweet_results?.result?.text) {
                    tweetText = tweet.note_tweet.note_tweet_results.result.text;
                }
                
                text += `${index + 1}. ${userCore.name || ''} (@${userCore.screen_name || ''})\n`;
                text += `日時: ${new Date(legacy.created_at).toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'})}\n`;
                text += `内容: ${tweetText}\n`;
                text += `いいね: ${legacy.favorite_count} | RT: ${legacy.retweet_count}\n`;
                text += `URL: https://x.com/${userCore.screen_name}/status/${legacy.id_str}\n`;
                text += `-`.repeat(30) + '\n\n';
            }
        }
    });
    
    return text;
}

async function downloadMarkdownFiles(data) {
    console.log(`🔍 Starting Markdown export for ${data.length} items`);
    
    // データの重複チェック
    const tweetIds = data.map(item => {
        if (item.content?.itemContent?.tweet_results?.result?.rest_id) {
            return item.content.itemContent.tweet_results.result.rest_id;
        }
        return null;
    }).filter(id => id);
    
    const uniqueTweetIds = new Set(tweetIds);
    console.log(`📊 Total items: ${data.length}, Valid tweets: ${tweetIds.length}, Unique tweet IDs: ${uniqueTweetIds.size}`);
    
    if (tweetIds.length !== uniqueTweetIds.size) {
        console.warn(`⚠️ Duplicate tweet IDs detected! ${tweetIds.length - uniqueTweetIds.size} duplicates found`);
        
        // 重複IDを表示
        const duplicates = tweetIds.filter((id, index) => tweetIds.indexOf(id) !== index);
        console.log('Duplicate IDs:', [...new Set(duplicates)]);
    }
    
    // 設定を最初に一度だけ取得
    const settings = await new Promise((resolve) => {
        chrome.storage.sync.get({downloadFolder: 'Twitter-Bookmarks'}, resolve);
    });
    
    let fileCount = 0;
    const usedFilenames = new Set(); // 重複ファイル名を防ぐ
    const processedTweetIds = new Set(); // 処理済みツイートIDを追跡
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // 個別ファイルを連続ダウンロード
    for (let index = 0; index < data.length; index++) {
        const item = data[index];
        if (item.content && item.content.itemContent && item.content.itemContent.tweet_results) {
            const tweet = item.content.itemContent.tweet_results.result;
            if (tweet && tweet.legacy) {
                const tweetId = tweet.rest_id || `tweet_${index + 1}`;
                
                // 重複処理チェック
                if (processedTweetIds.has(tweetId)) {
                    console.warn(`🔄 Skipping duplicate tweet ID: ${tweetId} at index ${index}`);
                    continue;
                }
                processedTweetIds.add(tweetId);
                
                const markdown = convertToMarkdown(item);
                
                // ユーザー名取得
                let username = 'unknown';
                if (tweet.core?.user_results?.result?.core?.screen_name) {
                    username = tweet.core.user_results.result.core.screen_name;
                }
                
                // 一意のファイル名を生成（重複を防ぐ）
                let baseFilename = `@${username}_${tweetId}`;
                let filename = `${baseFilename}.md`;
                let counter = 1;
                
                while (usedFilenames.has(filename)) {
                    filename = `${baseFilename}_${counter}.md`;
                    counter++;
                }
                usedFilenames.add(filename);
                
                const folderPath = settings.downloadFolder ? `${settings.downloadFolder}/markdown/${filename}` : `markdown/${filename}`;
                
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
                        }, 1000);
                        
                        resolve();
                    });
                });
                
                fileCount++;
                console.log(`📝 Downloaded ${fileCount}/${data.length}: ${filename}`);
                
                // ブラウザが詰まらないよう待機
                if (index % 5 === 4) { // 5ファイルごとに長めの休憩
                    await delay(1000);
                } else {
                    await delay(200);
                }
            }
        }
    }
    console.log(`✅ Generated ${fileCount} individual markdown files`);
}

function convertToMarkdown(item) {
    const tweet = item.content.itemContent.tweet_results.result;
    const legacy = tweet.legacy;
    
    // ユーザー情報の取得パスを修正（実際のJSON構造に基づく）
    let user = {};
    let userCore = {};
    let userLegacy = {};
    let avatar = {};
    
    if (tweet.core?.user_results?.result) {
        const userResult = tweet.core.user_results.result;
        user = userResult;
        userCore = userResult.core || {};
        userLegacy = userResult.legacy || {};
        avatar = userResult.avatar || {};
    }
    
    // デバッグ用ログ（最初のアイテムのみ）
    if (!window.debugLogged) {
        console.log('=== Tweet Debug Info (First Item) ===');
        console.log('Full tweet object:', tweet);
        console.log('Tweet.core:', tweet.core);
        console.log('Tweet.core.user_results:', tweet.core?.user_results);
        console.log('Tweet.core.user_results.result:', tweet.core?.user_results?.result);
        console.log('Tweet.legacy:', legacy);
        console.log('Found user info:', user);
        console.log('==================================');
        window.debugLogged = true; // 一度だけ表示
    }
    
    // 日付変換（日本時間で表示）
    const createdAt = new Date(legacy.created_at).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    const bookmarkDate = new Date(Number(BigInt(item.sortIndex) >> BigInt(20))).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    // ソースURL生成
    const sourceUrl = `https://x.com/${userCore.screen_name}/status/${tweet.rest_id}`;
    
    // メディアURL取得
    const mediaUrls = [];
    if (legacy.extended_entities && legacy.extended_entities.media) {
        legacy.extended_entities.media.forEach(media => {
            if (media.media_url_https) {
                mediaUrls.push(`${media.media_url_https}?format=jpg&name=orig`);
            }
        });
    }
    
    // テキスト取得: is_expandable=true の場合は note_tweet のテキストを使用
    let tweetText = legacy.full_text || '';
    if (tweet.note_tweet?.is_expandable && tweet.note_tweet?.note_tweet_results?.result?.text) {
        tweetText = tweet.note_tweet.note_tweet_results.result.text;
    }
    
    // 本文をプロパティに追加（YAMLで特殊文字をエスケープ）
    const escapedText = tweetText.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    
    // Markdownテンプレート生成（元の順番を維持）
    let markdown = `---\n`;
    markdown += `Date: ${createdAt}\n`;
    markdown += `twi_ProfileName: ${userCore.name || ''}\n`;
    markdown += `twi_ScreenName: ${userCore.screen_name || ''}\n`;
    markdown += `twi_UserId: ${user.rest_id || ''}\n`;
    markdown += `twi_TweetId: ${tweet.rest_id || ''}\n`;
    markdown += `twi_BookmarkDate: ${bookmarkDate}\n`;
    markdown += `twi_source: ${sourceUrl}\n`;
    markdown += `twi_profile_icon_url: ${avatar.image_url || ''}\n`;
    markdown += `twi_content: "${escapedText}"\n`;
    
    // メディアURL（最大4つ）
    for (let i = 0; i < 4; i++) {
        markdown += `twi_media_url_https${i + 1}: ${mediaUrls[i] || ''}\n`;
    }
    
    markdown += `---\n`;
    
    markdown += `${tweetText}\n\n`;
    
    // メディア画像の埋め込み
    if (mediaUrls.length > 0) {
        markdown += `## メディア\n\n`;
        mediaUrls.forEach((url, index) => {
            markdown += `![画像${index + 1}](${url})\n\n`;
        });
    }
    
    return markdown;
}

