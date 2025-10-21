const CHANGELOG = [
  {
    version: "1.1.2.1",
    date: "2025-10-21",
    title: "バージョン管理UIの導入",
    items: [
      "ヘッダー右上に現在バージョンを表示するバッジを追加（クリックで更新履歴を開く）",
      "更新履歴（Changelog）モーダルを実装し、最新順で内容を確認可能に",
      "設定ページに「バージョン情報＋更新履歴」セクションを追加",
      "ビルド前フックで build-meta.json を自動生成（version/commit/branch/builtAt）",
      "開発時はフェッチ失敗時に dev フォールバック表示で崩れないよう調整",
      "デフォルトで未完成のタスクのみを表示するように変更",
      ".gitignore に build-meta.json を追加（公開物へ直コミットしない運用）"
    ],
  },

  
];

export default CHANGELOG;
//バージョンを変える場合の手順
//このファイルにバージョンの履歴を追記
//package.jsonのバージョンを最新に変更
//git status
//git add
//git commit -m "ver x.x.x 変更内容"
//git push origin main
//git tag -a ver1.1.0 -m "feat(analytics): 内容 verのあとに空白を入れない"