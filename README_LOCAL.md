# Twitter Bookmarks Export - ローカル版

元の拡張機能から外部サービス通信を削除し、ローカルで安全に動作する全件エクスポート対応版です。

## 主な変更点

### 🔒 セキュリティ改善
- **外部サービス通信を完全削除**
  - toolboxforweb.xyz への通信を削除
  - Amplitude アナリティクスを削除
  - Statsig 設定管理サービスを削除
  - サポートサービス通信を削除

### ⚡ 機能改善
- **全件出力対応**
  - 100件制限を撤廃
  - 最速設定（50-100ms間隔）でダウンロード
  - すべてのブックマークを取得するまで自動継続

### 💾 データ保存
- **ローカルストレージに保存**
  - chrome.storage.local に JSON 形式で保存
  - 外部サーバーへの送信なし
  - プライバシー完全保護

## ファイル構成

```
manifest_local.json       # ローカル版マニフェスト
background_local.js       # 外部通信削除版バックグラウンドスクリプト
content_local.js          # 全件出力対応コンテンツスクリプト
README_LOCAL.md          # このファイル
```

## インストール方法

1. Chrome の拡張機能ページを開く (`chrome://extensions/`)
2. 「デベロッパーモード」を有効にする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. このフォルダを選択
5. マニフェストファイルとして `manifest_local.json` を指定

## 使用方法

1. Twitter/X のブックマークページ (`https://x.com/i/bookmarks`) を開く
2. 右上の青いエクスポートボタンをクリック
3. 全件ダウンロードが開始される
4. 完了後、chrome.storage.local にデータが保存される

## データアクセス方法

ブックマークデータは以下の方法でアクセスできます：

### 1. Chrome DevTools を使用
```javascript
// Console で実行
chrome.storage.local.get(['bookmarks'], (result) => {
  console.log(JSON.parse(result.bookmarks));
});
```

### 2. 拡張機能から取得
```javascript
// 別の拡張機能やスクリプトから
const data = await chrome.storage.local.get(['bookmarks']);
const bookmarks = JSON.parse(data.bookmarks);
```

## データ形式

```json
{
  "bookmarks": "[{...tweet data...}, {...tweet data...}]",
  "sync_at": 1640995200000
}
```

## 注意事項

⚠️ **開発者向けツール**  
これは開発者向けのツールです。Chrome拡張機能の開発者モードでのみ動作します。

⚠️ **利用規約の遵守**  
Twitter/X の利用規約を遵守して使用してください。

⚠️ **レート制限**  
Twitter API のレート制限を避けるため、適切な間隔でリクエストを行います。

## 技術的詳細

### 削除された外部通信
- `https://bookmarks.toolboxforweb.xyz/*`
- `https://amplitude.com/*` 
- Statsig API calls
- `https://chirpnotes.freshdesk.com/*`

### 設定値
- `wait_interval_ms`: 100ms (最速設定)
- `script_ver`: 1 (固定値)
- 停止条件: なし（全件取得）

### 権限
必要最小限の権限のみ：
- `webRequest`: Twitter API リクエストの傍受
- `storage`: ローカルデータ保存
- `unlimitedStorage`: 大量ブックマークデータの保存
- `host_permissions`: Twitter/X ドメインのみ

## ライセンス

このローカル版は元の拡張機能のセキュリティ改善版です。
個人利用・研究目的のみでご使用ください。