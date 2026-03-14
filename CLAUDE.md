# プロジェクト改善メモ

## リリース手順
- 「リリース」と指示された場合は、以下を必ずすべて実行すること:
  1. manifest.jsonのバージョンを更新（Chrome版・Firefox版の両方）
  2. コードをコミット
  3. `dist/` 配下にリリースアセットを生成（`zip -j` でパッケージング）
     - `dist/twitter-bookmarks-export-chrome-{version}.zip`
     - `dist/twitter-bookmarks-export-firefox-{version}.zip`
     - `dist/twitter-bookmarks-export-firefox-{version}.xpi`（zipのコピー）
  4. distアセットを `git add -f` でコミット（.gitignoreで*.zipが除外されているため）
  5. `git push origin master`
  6. `gh release create` でGitHub Releaseを作成し、distアセット3つを添付
     - タイトル形式: `v{version} - 変更の要約`
     - 過去のリリースノートのスタイルに合わせる
- distアセットの生成・GitHub Releaseの作成を絶対に忘れないこと
