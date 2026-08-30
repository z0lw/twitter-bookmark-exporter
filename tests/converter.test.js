const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadConverter(relativePath) {
    const filename = path.resolve(__dirname, '..', relativePath);
    const source = fs.readFileSync(filename, 'utf8');
    const context = {};
    vm.createContext(context);
    vm.runInContext(source, context, { filename });
    return {
        convertToMarkdown: context.convertToMarkdown,
        convertToCSV: context.convertToCSV,
        convertToText: context.convertToText
    };
}

function makeBookmarkItem() {
    const timestamp = BigInt(new Date('2026-08-28T12:34:56Z').getTime());
    return {
        sortIndex: String(timestamp << 20n),
        content: {
            itemContent: {
                tweet_results: {
                    result: {
                        __typename: 'Tweet',
                        rest_id: '1234567890123456789',
                        core: {
                            user_results: {
                                result: {
                                    __typename: 'User',
                                    rest_id: '9876543210987654321',
                                    core: {
                                        name: 'Example: "User"',
                                        screen_name: 'example_user'
                                    },
                                    legacy: {
                                        description: 'Profile text',
                                        profile_image_url_https: 'https://example.com/avatar.jpg'
                                    }
                                }
                            }
                        },
                        legacy: {
                            id_str: '1234567890123456789',
                            created_at: 'Fri Aug 28 12:00:00 +0000 2026',
                            full_text: 'First line https://t.co/article\nSecond line https://t.co/photo',
                            entities: {
                                urls: [{
                                    url: 'https://t.co/article',
                                    expanded_url: 'https://redirect.example.com/article',
                                    unwound_url: 'https://example.com/articles/expanded'
                                }],
                                media: [{
                                    url: 'https://t.co/photo',
                                    expanded_url: 'https://x.com/example_user/status/1234567890123456789/photo/1'
                                }]
                            },
                            extended_entities: { media: [] }
                        }
                    }
                }
            }
        }
    };
}

function makeLongNoteBookmarkItem() {
    const item = makeBookmarkItem();
    const tweet = item.content.itemContent.tweet_results.result;
    tweet.note_tweet = {
        is_expandable: true,
        note_tweet_results: {
            result: {
                text: 'Long note https://t.co/note',
                entity_set: {
                    urls: [{
                        url: 'https://t.co/note',
                        expanded_url: 'https://example.org/long-note'
                    }]
                }
            }
        }
    };
    return item;
}

for (const converterPath of [
    'chrome-version/converter.js',
    'firefox-version/converter.js'
]) {
    const { convertToMarkdown, convertToCSV, convertToText } = loadConverter(converterPath);
    const bookmark = makeBookmarkItem();
    const markdown = convertToMarkdown(bookmark);

    assert.equal(
        markdown.includes('\ntwi_content:'),
        false,
        `${converterPath} must not duplicate the tweet body in twi_content`
    );
    assert.equal(
        markdown.includes('\n---\nFirst line https://example.com/articles/expanded\nSecond line https://x.com/example_user/status/1234567890123456789/photo/1\n'),
        true,
        `${converterPath} must expand t.co URLs in the Markdown body`
    );
    assert.equal(
        markdown.includes('twi_ProfileName: "Example: \\"User\\""\n'),
        true,
        `${converterPath} must serialize frontmatter strings safely`
    );
    assert.equal(markdown.includes('https://t.co/'), false, `${converterPath} Markdown must not retain known t.co URLs`);
    assert.equal(convertToCSV([bookmark]).includes('https://t.co/'), false, `${converterPath} CSV must expand known t.co URLs`);
    assert.equal(convertToText([bookmark]).includes('https://t.co/'), false, `${converterPath} text must expand known t.co URLs`);

    const longNoteMarkdown = convertToMarkdown(makeLongNoteBookmarkItem());
    assert.equal(longNoteMarkdown.includes('Long note https://example.org/long-note'), true, `${converterPath} must expand note-tweet URLs`);
    assert.equal(longNoteMarkdown.includes('https://t.co/note'), false, `${converterPath} note-tweet Markdown must not retain known t.co URLs`);
}

console.log('converter.test.js: PASS');
