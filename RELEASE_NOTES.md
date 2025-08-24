# Twitter Bookmark Exporter v1.0.0

## リリース日
2025-08-24

## 主な機能

### Firefox版
- Twitterブックマークのエクスポート機能
- Markdownフォーマットでの出力対応
- 画像・動画・GIFを含むツイートの完全サポート
- 引用ツイートやリツイートの階層表示
- タブ管理機能による効率的なAPI通信

### Chrome版  
- Manifest V3対応
- Service Worker実装による安定動作
- 同様のエクスポート機能

## 技術仕様
- Firefox: Manifest V2 (Gecko互換)
- Chrome: Manifest V3 (Service Worker)
- 対応サイト: twitter.com, x.com

## ダウンロード
- Firefox版: `firefox-version/web-ext-artifacts/twitter_bookmarks_export_-_firefox-1.0.0.zip`
- Chrome版: `chrome-version/web-ext-artifacts/twitter_bookmarks_export_-_local-1.0.0.zip`

## インストール方法

### Firefox
1. Firefoxを開き、`about:debugging`にアクセス
2. 「このFirefox」をクリック
3. 「一時的なアドオンを読み込む」から.zipファイルを選択

### Chrome
1. Chromeを開き、`chrome://extensions/`にアクセス
2. 開発者モードを有効化
3. .zipファイルを解凍し、「パッケージ化されていない拡張機能を読み込む」から選択

## 注意事項
- プライベート使用を前提としています
- Twitter/X APIの仕様変更により動作しなくなる可能性があります