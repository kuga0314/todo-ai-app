// export-csv.js
// Firestore → CSVエクスポート（tasks.csv / daily_progress.csv）
// UTF-8 with BOM（Excel対応）+ 秘密鍵は環境変数から読む

const fs = require("fs");
const path = require("path");
const { parse } = require("json2csv");
const admin = require("firebase-admin");
require("dotenv").config(); // .env を読む（なければ何もしない）

/** ── 認証情報の読み込み（順に優先） ─────────────────────────
 * 1) FIREBASE_ADMIN_KEY_JSON …… サービスアカウントJSONをそのまま文字列で
 * 2) GOOGLE_APPLICATION_CREDENTIALS …… JSONファイルパス
 * 3) それ以外 → エラー
 */
function loadServiceAccount() {
  const jsonInline = process.env.FIREBASE_ADMIN_KEY_JSON;
  if (jsonInline) {
    return JSON.parse(jsonInline);
  }
  const gacPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (gacPath) {
    const raw = fs.readFileSync(gacPath, "utf8");
    return JSON.parse(raw);
  }
  throw new Error(
    "Service Account credentials not found. Set FIREBASE_ADMIN_KEY_JSON or GOOGLE_APPLICATION_CREDENTIALS."
  );
}

admin.initializeApp({
  credential: admin.credential.cert(loadServiceAccount()),
});
const db = admin.firestore();

(async () => {
  console.log("=== Firestore Export Start ===");

  const todosSnap = await db.collection("todos").get();

  const dailyRows = []; // 日次実績
  const taskRows = [];  // タスク台帳

  todosSnap.forEach((docSnap) => {
    const t = docSnap.data() || {};
    const logs = t.actualLogs || {};

    // タスク台帳（全タスク1行）
    taskRows.push({
      taskId: docSnap.id,
      userId: t.userId || t.uid || "",
      text: t.text || "",
      createdAt: t.createdAt?.toDate?.()?.toISOString() || "",
      deadline: t.deadline?.toDate?.()?.toISOString() || "",
      eacDate: t.eacDate || "",
      estimatedMinutes: Number(t.estimatedMinutes ?? 0),
      actualTotalMinutes: Number(t.actualTotalMinutes ?? 0),
      completed: !!t.completed,
      labelId: t.labelId || "",
      priority: t.priority ?? "",
    });

    // 日次実績（actualLogsのある日だけ）
    for (const [date, minutes] of Object.entries(logs)) {
      dailyRows.push({
        taskId: docSnap.id,
        userId: t.userId || t.uid || "",
        text: t.text || "",
        date, // YYYY-MM-DD
        actualMinutes: Number(minutes ?? 0),
        estimatedMinutes: Number(t.estimatedMinutes ?? 0),
        deadline: t.deadline?.toDate?.()?.toISOString() || "",
        eacDate: t.eacDate || "",
        completed: !!t.completed,
      });
    }
  });

  // CSV出力（UTF-8 BOM付き）
  const outDir = path.resolve(__dirname);
  const csvOpts = { withBOM: true };
  const csvTasks = parse(taskRows, csvOpts);
  const csvDaily = parse(dailyRows, csvOpts);

  fs.writeFileSync(path.join(outDir, "tasks.csv"), csvTasks, "utf8");
  fs.writeFileSync(path.join(outDir, "daily_progress.csv"), csvDaily, "utf8");

  console.log(`✅ tasks.csv: ${taskRows.length} rows`);
  console.log(`✅ daily_progress.csv: ${dailyRows.length} rows`);
  console.log("=== Export Complete ===");
})();
