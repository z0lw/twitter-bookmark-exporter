// Twitter Bookmark Exporter - Shared Converter Functions
// background scripts と download_result scripts で共有される純粋なデータ変換関数

function normalizeUserCandidate(candidate) {
    if (!candidate || typeof candidate !== 'object') {
        return null;
    }
    if (candidate.__typename === 'User') {
        return candidate;
    }
    if (candidate.legacy && (candidate.rest_id || candidate.id_str || candidate.legacy.screen_name)) {
        return candidate;
    }
    if (candidate.result && candidate !== candidate.result) {
        return normalizeUserCandidate(candidate.result);
    }
    if (candidate.user && candidate !== candidate.user) {
        return normalizeUserCandidate(candidate.user);
    }
    if (!candidate.legacy && candidate.screen_name) {
        return {
            legacy: candidate,
            core: candidate.core || {},
            rest_id: candidate.rest_id || candidate.id_str || candidate.user_id_str || ''
        };
    }
    return null;
}

function addUserCandidatesFromUserResults(userResults, bucket) {
    if (!userResults) return;
    if (userResults.result) {
        bucket.push(userResults.result);
    }
    if (Array.isArray(userResults.results)) {
        userResults.results.forEach(entry => bucket.push(entry));
    }
    if (Array.isArray(userResults.users)) {
        userResults.users.forEach(entry => bucket.push(entry));
    }
}

function addUserCandidatesFromTweet(tweet, bucket) {
    if (!tweet || typeof tweet !== 'object') return;
    const actualTweet = (tweet.__typename === 'TweetWithVisibilityResults' && tweet.tweet) ? tweet.tweet : tweet;
    if (!actualTweet) return;
    addUserCandidatesFromUserResults(actualTweet.core?.user_results, bucket);
    if (actualTweet.core?.user) {
        bucket.push(actualTweet.core.user);
    }
    if (actualTweet.author) {
        bucket.push(actualTweet.author);
    }
    if (actualTweet.user) {
        bucket.push(actualTweet.user);
    }
    if (actualTweet.note_tweet?.note_tweet_results?.result) {
        addUserCandidatesFromTweet(actualTweet.note_tweet.note_tweet_results.result, bucket);
    }
}

function resolveUserEntitiesFromItem(item) {
    const fallback = { user: {}, userCore: {}, userLegacy: {}, avatar: {} };
    if (!item || typeof item !== 'object') {
        return fallback;
    }
    const candidates = [];
    const tweetResult = item.content?.itemContent?.tweet_results?.result;
    if (tweetResult) {
        addUserCandidatesFromTweet(tweetResult, candidates);
    }
    if (item.content?.user_results) {
        addUserCandidatesFromUserResults(item.content.user_results, candidates);
    }
    if (Array.isArray(candidates) && candidates.length > 0) {
        for (const candidate of candidates) {
            const normalized = normalizeUserCandidate(candidate);
            if (!normalized) continue;
            const userCore = normalized.core || {};
            const userLegacy = normalized.legacy || {};
            const hasIdentity = !!(userLegacy.screen_name || userCore.screen_name || userLegacy.name || userCore.name);
            if (!hasIdentity) continue;
            const avatar = candidate?.avatar || normalized.avatar || {};
            return { user: normalized, userCore, userLegacy, avatar };
        }
        for (const candidate of candidates) {
            const normalized = normalizeUserCandidate(candidate);
            if (!normalized) continue;
            const avatar = candidate?.avatar || normalized.avatar || {};
            return { user: normalized, userCore: normalized.core || {}, userLegacy: normalized.legacy || {}, avatar };
        }
    }
    return fallback;
}

function resolveDownloadFolder(baseFolder, acctInfo) {
    if (!acctInfo) {
        return baseFolder;
    }
    const sanitize = (value) => String(value).replace(/[^a-zA-Z0-9_\-]/g, '');
    const suffixCandidates = [
        acctInfo.folderSuffix,
        acctInfo.screenName,
        acctInfo.userId ? String(acctInfo.userId).slice(-4) : null
    ].filter(Boolean).map(sanitize).filter(Boolean);

    if (suffixCandidates.length === 0) {
        return baseFolder;
    }

    const suffix = suffixCandidates[0];
    const base = (baseFolder && baseFolder.trim().length > 0) ? baseFolder.trim() : 'Twitter-Bookmarks';
    if (base.endsWith(`_${suffix}`)) {
        return base;
    }
    return `${base}_${suffix}`;
}

function convertToCSV(data) {
    const headers = ['日付', 'ユーザー名', 'ユーザーID', 'ツイート内容', 'いいね数', 'RT数', 'URL'];
    const rows = [headers.join(',')];

    data.forEach(item => {
        if (item.content && item.content.itemContent && item.content.itemContent.tweet_results) {
            const tweet = item.content.itemContent.tweet_results.result;
            if (tweet && tweet.legacy) {
                const legacy = tweet.legacy;
                const { userCore, userLegacy } = resolveUserEntitiesFromItem(item);
                const resolvedName = (userCore.name || userLegacy.name || '').replace(/"/g, '""');
                const resolvedScreenName = userCore.screen_name || userLegacy.screen_name || '';

                let tweetText = legacy.full_text || '';
                if (tweet.note_tweet?.is_expandable && tweet.note_tweet?.note_tweet_results?.result?.text) {
                    tweetText = tweet.note_tweet.note_tweet_results.result.text;
                }

                const row = [
                    `"${new Date(legacy.created_at).toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'})}"`,
                    `"${resolvedName}"`,
                    `"${resolvedScreenName}"`,
                    `"${tweetText.replace(/"/g, '""').replace(/\n/g, ' ')}"`,
                    legacy.favorite_count || 0,
                    legacy.retweet_count || 0,
                    `"https://x.com/${resolvedScreenName || 'i'}/status/${legacy.id_str}"`
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
                const { userCore, userLegacy } = resolveUserEntitiesFromItem(item);
                const resolvedName = userCore.name || userLegacy.name || '';
                const resolvedScreenName = userCore.screen_name || userLegacy.screen_name || '';

                let tweetText = legacy.full_text || '';
                if (tweet.note_tweet?.is_expandable && tweet.note_tweet?.note_tweet_results?.result?.text) {
                    tweetText = tweet.note_tweet.note_tweet_results.result.text;
                }

                text += `${index + 1}. ${resolvedName} (@${resolvedScreenName})\n`;
                text += `日時: ${new Date(legacy.created_at).toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'})}\n`;
                text += `内容: ${tweetText}\n`;
                text += `いいね: ${legacy.favorite_count} | RT: ${legacy.retweet_count}\n`;
                text += `URL: https://x.com/${resolvedScreenName || 'i'}/status/${legacy.id_str}\n`;
                text += `-`.repeat(30) + '\n\n';
            }
        }
    });

    return text;
}

function convertToMarkdown(item) {
    let tweet = item.content.itemContent.tweet_results.result;

    if (tweet && tweet.__typename === 'TweetWithVisibilityResults' && tweet.tweet) {
        tweet = tweet.tweet;
    }
    const legacy = tweet.legacy || {};

    const { user, userCore, userLegacy, avatar } = resolveUserEntitiesFromItem(item);
    const profileDesc = userLegacy.description || '';
    const escapedProfile = profileDesc.replace(/\"/g, '\\"').replace(/\n/g, '\\n');
    const profileBannerUrl = userLegacy.profile_banner_url || '';
    const profileLocation = userLegacy.location || '';
    let profileUrl = '';
    try {
        if (userLegacy.entities && userLegacy.entities.url && Array.isArray(userLegacy.entities.url.urls) && userLegacy.entities.url.urls.length > 0) {
            profileUrl = userLegacy.entities.url.urls[0].expanded_url || userLegacy.entities.url.urls[0].url || '';
        }
    } catch (e) {
        profileUrl = '';
    }

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

    const resolvedProfileName = userCore.name || userLegacy.name || '';
    const resolvedScreenName = userCore.screen_name || userLegacy.screen_name || '';

    const userIdCandidate = user?.rest_id || userLegacy.rest_id || userLegacy.user_id_str || legacy.user_id_str || '';
    const tweetIdCandidate = tweet?.rest_id || legacy.id_str || '';
    const resolvedUserId = userIdCandidate ? String(userIdCandidate) : '';
    const resolvedTweetId = tweetIdCandidate ? String(tweetIdCandidate) : '';
    const escapedUserId = resolvedUserId.replace(/"/g, '\\"');
    const escapedTweetId = resolvedTweetId.replace(/"/g, '\\"');
    const sourceUrlTweetId = resolvedTweetId || tweet.rest_id || legacy.id_str || '';
    const sourceUrl = resolvedScreenName ? `https://x.com/${resolvedScreenName}/status/${sourceUrlTweetId}` : `https://x.com/i/status/${sourceUrlTweetId}`;

    const mediaUrls = [];
    if (legacy.extended_entities && legacy.extended_entities.media) {
        legacy.extended_entities.media.forEach(media => {
            if (media.media_url_https) {
                mediaUrls.push(`${media.media_url_https}?format=jpg&name=orig`);
            }
        });
    }

    let tweetText = legacy.full_text || '';
    if (tweet.note_tweet?.is_expandable && tweet.note_tweet?.note_tweet_results?.result?.text) {
        tweetText = tweet.note_tweet.note_tweet_results.result.text;
    }

    const escapedText = tweetText.replace(/"/g, '\\"').replace(/\n/g, '\\n');

    let markdown = `---\n`;
    markdown += `twi_isSensitiveMedia:\n`;
    markdown += `Date: ${createdAt}\n`;
    markdown += `twi_ProfileName: ${resolvedProfileName}\n`;
    markdown += `twi_ScreenName: ${resolvedScreenName}\n`;
    markdown += `twi_UserId: "${escapedUserId}"\n`;
    markdown += `twi_TweetId: "${escapedTweetId}"\n`;
    markdown += `twi_BookmarkDate: ${bookmarkDate}\n`;
    markdown += `twi_source: ${sourceUrl}\n`;
    const profileIconUrl = avatar.image_url || userLegacy.profile_image_url_https || '';
    markdown += `twi_profile_icon_url: ${profileIconUrl}\n`;
    markdown += `twi_profile_banner_url: ${profileBannerUrl}\n`;
    markdown += `twi_profile: "${escapedProfile}"\n`;
    markdown += `twi_profile_url: ${profileUrl}\n`;
    markdown += `twi_profile_location: ${profileLocation}\n`;
    markdown += `twi_content: "${escapedText}"\n`;

    for (let i = 0; i < 4; i++) {
        markdown += `twi_media_url_https${i + 1}: ${mediaUrls[i] || ''}\n`;
    }

    markdown += `---\n`;

    markdown += `${tweetText}\n\n`;

    if (mediaUrls.length > 0) {
        markdown += `## メディア\n\n`;
        mediaUrls.forEach((url, index) => {
            markdown += `![画像${index + 1}](${url})\n\n`;
        });
    }

    return markdown;
}
