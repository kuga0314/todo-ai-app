# export_plan_behavior.js

Firestore から「当日最終の今日のプラン」と実績ログを突き合わせ、分析用 CSV を生成するスクリプトです。分析③（行動の配分・選択）を Colab で行うための入力データをまとめます。

## 前提条件
- Node.js 18+ を想定しています。
- Firebase Admin SDK 用の認証をいずれかで用意してください。
  - 環境変数 `FIREBASE_ADMIN_KEY_JSON` にサービスアカウント JSON を直接設定
  - 環境変数 `GOOGLE_APPLICATION_CREDENTIALS` に JSON ファイルのパスを設定（Application Default Credentials）
  - カレントディレクトリに `serviceAccountKey.json` を配置
- `.env` からも環境変数を読み込みます。

## 使い方
```bash
node export_plan_behavior.js \
  --start=YYYY-MM-DD \
  --end=YYYY-MM-DD \
  --outDir=./exports \
  --allUsers \
  [--userId=UID] \
  [--includeRevisions] \
  [--preview]
```

### 引数の説明
- `--start`, `--end` (必須): 抽出する日付範囲（`YYYY-MM-DD`）。`dailyPlans` の docId と `actualLogs` のキーに対して inclusive でフィルタされます。
- `--outDir`: CSV 出力先ディレクトリ（デフォルト: `./exports`）。なければ自動作成します。
- `--allUsers`: `users` コレクション配下の全ユーザーを対象にします。
- `--userId`: 特定ユーザーだけを対象にするデバッグ用フィルタ。`--allUsers` と併用可能ですが、両方省略することはできません。
- `--includeRevisions`: `dailyPlans/{date}/revisions` を追加で `plan_revisions_items.csv` に出力します（デフォルト: 出力しない）。
- `--preview`: 生成した各 CSV の先頭行をコンソールに表示します。

### 出力される CSV
出力先ディレクトリに以下のファイルを生成します（ヘッダー付き, UTF-8）。

1. `plan_items.csv`
   - 1行 = ユーザー×日付×プラン内タスク
   - 列: `userId`, `dateKey`, `capMinutes`, `todoId`, `plannedMinutes`, `requiredMinutes`, `order`, `title`

2. `actual_by_todo_day.csv`
   - 1行 = ユーザー×日付×タスクの実績（当日合計）
   - 列: `userId`, `dateKey`, `todoId`, `actualMinutes`

3. `plan_actual_join.csv`
   - 1行 = ユーザー×日付×todoId の FULL OUTER JOIN 相当結果
   - 列: `userId`, `dateKey`, `todoId`, `isPlanned`, `plannedMinutes`, `actualMinutes`, `capMinutes`, `order`, `title`
   - プラン外実績も含まれます。`plannedMinutes` はプラン外なら `0`、`actualMinutes` は実績なしなら `0` です。

4. `plan_revisions_items.csv` (`--includeRevisions` 指定時のみ)
   - 1行 = ユーザー×日付×revision×item
   - 列: `userId`, `dateKey`, `revisionId`, `revisedAt`, `capMinutes`, `todoId`, `plannedMinutes`, `requiredMinutes`, `order`, `title`

### 実行時ログ
- 対象ユーザー数
- 対象日数（プランまたは実績があった日付のユニーク数）
- `plan_items` / `actual_by_todo_day` / `plan_actual_join` / `plan_revisions_items`（オプション）の行数

### 動作確認例
Firestore 認証をセットした上で、任意の UID でプレビューする例:
```bash
node export_plan_behavior.js \
  --start=2025-12-09 \
  --end=2025-12-18 \
  --outDir=./exports \
  --allUsers \
  --userId=YOUR_UID \
  --preview
```
