let bookmarksData = [];

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
        
        browser.storage.local.get(['bookmarks']).then((result) => {
            if (result.bookmarks) {
                try {
                    bookmarksData = JSON.parse(result.bookmarks);
                    document.getElementById('bookmarkCount').textContent = `${bookmarksData.length}件`;
                    console.log('✅ Bookmarks loaded from storage:', bookmarksData.length);
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
    browser.storage.local.get({downloadFolder: 'Twitter-Bookmarks'}).then((settings) => {
        const folderPath = settings.downloadFolder ? `${settings.downloadFolder}/${filename}` : filename;
        
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

function convertToCSV(data) {
    const headers = ['日付', 'ユーザー名', 'ユーザーID', 'ツイート内容', 'いいね数', 'RT数', 'URL'];
    const rows = [headers.join(',')];
    
    data.forEach(item => {
        if (item.content && item.content.itemContent && item.content.itemContent.tweet_results) {
            const tweet = item.content.itemContent.tweet_results.result;
            if (tweet && tweet.legacy) {
                const legacy = tweet.legacy;
                let userCore = {};
                if (tweet.core?.user_results?.result?.legacy) {
                    userCore = tweet.core.user_results.result.legacy;
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
                if (tweet.core?.user_results?.result?.legacy) {
                    userCore = tweet.core.user_results.result.legacy;
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
    const settings = await new Promise((resolve) => {
        browser.storage.local.get({downloadFolder: 'Twitter-Bookmarks'}, resolve);
    });
    
    let fileCount = 0;
    const usedFilenames = new Set(); // 重複ファイル名を防ぐ
    const processedTweetIds = new Set(); // 処理済みツイートIDを追跡
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // 補助: ファイル名用のscreen_name抽出（多様なレスポンスに対応）
    function getScreenNameForFilename(tw) {
        if (!tw) return 'unknown';
        let t = (tw.__typename === 'TweetWithVisibilityResults' && tw.tweet) ? tw.tweet : tw;
        const ur = t.core?.user_results?.result;
        const sn = ur?.legacy?.screen_name || ur?.core?.screen_name;
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
                let username = getScreenNameForFilename(tweet);
                
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

function convertToMarkdown(item) {
    let tweet = item.content.itemContent.tweet_results.result;
    
    // TweetWithVisibilityResultsの場合、内部のtweetを取得
    if (tweet && tweet.__typename === 'TweetWithVisibilityResults' && tweet.tweet) {
        tweet = tweet.tweet;
    }
    const legacy = tweet.legacy;
    
    // ユーザー情報の取得パスを修正（実際のJSON構造に基づく）
    let user = {};
    let userCore = {};
    let userLegacy = {};
    let avatar = {};
    // プロフィール関連の初期値
    let escapedProfile = '';
    let profileBannerUrl = '';
    let profileLocation = '';
    let profileUrl = '';
    
    if (tweet.core?.user_results?.result) {
        const userResult = tweet.core.user_results.result;
        user = userResult;
        // Firefox版では legacy にユーザー情報がある
        userLegacy = userResult.legacy || {};
        userCore = userLegacy; // legacyをuserCoreとして使用
        avatar = userResult.avatar || {};
        
        // プロフィール説明とバナーURL
        const profileDesc = (userLegacy.description || '');
        escapedProfile = profileDesc.replace(/\"/g, '\\"').replace(/\n/g, '\\n');
        profileBannerUrl = userLegacy.profile_banner_url || '';
        profileLocation = userLegacy.location || '';
        try {
            if (userLegacy.entities && userLegacy.entities.url && Array.isArray(userLegacy.entities.url.urls) && userLegacy.entities.url.urls.length > 0) {
                profileUrl = userLegacy.entities.url.urls[0].expanded_url || userLegacy.entities.url.urls[0].url || '';
            }
        } catch (e) {
            profileUrl = '';
        }

        // デバッグ: ユーザー情報の確認
        if (!userCore.name || !userCore.screen_name) {
            console.warn('⚠️ Missing user info:', {
                name: userCore.name,
                screen_name: userCore.screen_name,
                userLegacy: userLegacy,
                userResult: userResult
            });
        }
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
    
    // Markdownテンプレート生成
    let markdown = `---\n`;
    // 手動判定用フラグ（値は未設定で出力）。フロントマターの最初の行
    markdown += `twi_isSensitiveMedia:\n`;
    markdown += `Date: ${createdAt}\n`;
    markdown += `twi_ProfileName: ${userCore.name || ''}\n`;
    markdown += `twi_ScreenName: ${userCore.screen_name || ''}\n`;
    markdown += `twi_UserId: ${user.rest_id || ''}\n`;
    markdown += `twi_TweetId: ${tweet.rest_id || ''}\n`;
    markdown += `twi_BookmarkDate: ${bookmarkDate}\n`;
    markdown += `twi_source: ${sourceUrl}\n`;
    markdown += `twi_profile_icon_url: ${userCore.profile_image_url_https || ''}\n`;
    markdown += `twi_profile_banner_url: ${profileBannerUrl}\n`;
    markdown += `twi_profile: "${escapedProfile}"\n`;
    markdown += `twi_profile_url: ${profileUrl}\n`;
    markdown += `twi_profile_location: ${profileLocation}\n`;
    markdown += `twi_content: "${escapedText}"\n`;

    // センシティブ系5項目は出力しない（要望により削除）

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
