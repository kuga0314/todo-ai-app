# export_eac_events.js の使い方

## 概要
Firestore に保存されている todos の日時実績 (`actualLogs`) から日次 EAC を再構成し、
- `exports/eac_daily.csv`（タスク×日次の系列データ）
- `exports/eac_events.csv`（EAC が締切を超過したイベント）
を出力する単発 Node.js スクリプトです。既存データは読み取り専用で変更しません。

## 事前準備
- Node.js 実行環境（`npm install` 済みを想定）
- Firestore Admin SDK 用のサービスアカウント鍵
  - `FIREBASE_ADMIN_KEY_JSON`（JSON 文字列）または `GOOGLE_APPLICATION_CREDENTIALS`（鍵ファイルパス）で指定できます。
  - どちらも設定されていない場合は `./serviceAccountKey.json` を自動探索します。
- 必要に応じて `.env` をスクリプトと同じ階層に配置してください。

## 実行方法
```bash
# 単一ユーザー
node export_eac_events.js --userId=USER_UID --start=2025-10-01 --end=2025-12-31 [--preview]

# すべてのユーザー
node export_eac_events.js --allUsers --start=2025-10-01 --end=2025-12-31 [--preview]
```
- `--userId` : 対象ユーザーの UID（単一ユーザー出力時に必須）
- `--allUsers` : 全ユーザー分をまとめて出力する場合に指定
- `--start` / `--end` : 期間（YYYY-MM-DD、両端を含む、Asia/Tokyo 基準）
- `--preview` : 生成した CSV の先頭 5 行をコンソール表示

出力は `./exports` ディレクトリに保存されます（無ければ自動生成）。

## 出力カラム
### eac_daily.csv
|列名|説明|
|---|---|
|userId|ユーザー UID|
|todoId|タスク ID|
|dateKey|日付（YYYY-MM-DD, JST）|
|deadlineKey|締切日（YYYY-MM-DD, JST）|
|estimatedMinutes|見積り所要時間（分）|
|minutes|該当日の実績（分、実績なしは 0）|
|cumMinutes|開始〜当日までの累積実績（分）|
|pace7d|直近 7 日の平均ペース（分/日。分母は daysWorked<3 の場合 daysWorked または 1、それ以外は 7）|
|spi|pace7d / requiredPace（締切なしは null）|
|eacDateKey|再構成した予測完了日（YYYY-MM-DD。pace7d<=0 かつ残作業>0 は null）|
|eacOverDeadline|eacDateKey > deadlineKey の場合 true。締切なしは空欄、残作業 0 は false|
|completed|タスク完了フラグ|
|hasPlan|その日の dailyPlans が存在するか|
|planContainsThisTodo|dailyPlans に当該 todoId が含まれるか|
|planAllocatedMinutes|dailyPlans の items における plannedMinutes（該当なしは空欄）|

### eac_events.csv
|列名|説明|
|---|---|
|userId|ユーザー UID|
|todoId|タスク ID|
|eventDateKey|EAC 超過イベント日（前日 eacOverDeadline=false かつ当日 true）|
|deadlineKey|締切日（YYYY-MM-DD, JST）|
|estimatedMinutes|見積り所要時間（分）|
|eacDateKey_at_event|イベント当日の EAC 日付（YYYY-MM-DD）|
|minutes_before_7d_avg|イベント日前 1〜7 日の平均実績（存在する日だけで平均）|
|minutes_after_7d_avg|イベント日後 1〜7 日の平均実績（同上）|
|delta_minutes_7d|after - before|
|pace7d_at_event|イベント当日の pace7d|
|spi_at_event|イベント当日の SPI|
|hasPlan_at_event|イベント当日に dailyPlans が存在するか|
|planContainsThisTodo_at_event|イベント当日の dailyPlans に当該タスクが含まれるか|
|notes|欠損や除外理由のメモ用（現状は空欄）|

## ログ出力
実行時に以下をコンソールへ表示します。
- 取得した todos 数
- 生成した dateRange の日数
- eac_daily の null EAC 行数（pace7d<=0 で予測不能となった日）
- eac_events の行数
- `--preview` 指定時は各 CSV の先頭 5 行
