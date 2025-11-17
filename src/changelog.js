const CHANGELOG = [
  {
    version: "1.1.2.7",
    date: "2025-11-17",
    title: "遅延表記の修正",
    items: [
      "タスクタブにおいて締め切りを過ぎた場合もリスクレベルが赤色に表示されない問題を修正しました。",
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
//git tag -a ver1.1.0 -m "feat(analytics):内容 verのあとに空白を入れない"