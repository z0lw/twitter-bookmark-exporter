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
    return context.convertToMarkdown;
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
                            full_text: 'First line\nSecond line',
                            extended_entities: { media: [] }
                        }
                    }
                }
            }
        }
    };
}

for (const converterPath of [
    'chrome-version/converter.js',
    'firefox-version/converter.js'
]) {
    const convertToMarkdown = loadConverter(converterPath);
    const markdown = convertToMarkdown(makeBookmarkItem());

    assert.equal(
        markdown.includes('\ntwi_content:'),
        false,
        `${converterPath} must not duplicate the tweet body in twi_content`
    );
    assert.equal(
        markdown.includes('\n---\nFirst line\nSecond line\n'),
        true,
        `${converterPath} must preserve the tweet text in the Markdown body`
    );
    assert.equal(
        markdown.includes('twi_ProfileName: "Example: \\"User\\""\n'),
        true,
        `${converterPath} must serialize frontmatter strings safely`
    );
}

console.log('converter.test.js: PASS');
