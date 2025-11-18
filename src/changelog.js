const CHANGELOG = [
  {
    version: "1.1.2.8",
    date: "2025-11-18",
    title: "ログ編集部分のバグ修正",
    items: [
      "空ログ日でも既存ログ入力欄が自動で「0」にならず空欄から入力を始められるようにし、モーダルを開き直すたびに入力をリセットするよう調整しました。",
      "分数欄に「030」のような先頭ゼロ付きの値が入力された場合は保存させず、「先頭に0を付けずに入力してください」と警告するバリデーションを追加しました。",
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