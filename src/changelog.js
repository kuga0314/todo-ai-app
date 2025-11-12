const CHANGELOG = [
  {
    version: "1.1.2.6",
    date: "2025-11-12",
    title: "通知設定の修正",
    items: [
      "複数端末での通知機能に対応しました。",
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