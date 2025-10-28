const CHANGELOG = [
  {
    version: "1.1.2.3",
    date: "2025-10-28",
    title: "遅延判定ロジックの修正",
    items: [
      "締切を過ぎた未完了タスクが正しく🔴「遅延」と表示されるように修正。",
      "Analytics画面でも締切超過時に自動的に遅延扱いとなるよう補正。",
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