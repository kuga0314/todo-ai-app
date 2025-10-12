// export-csv.js
// Firestore → CSVエクスポート（tasks.csv / daily_progress.csv）
// ・UTF-8 with BOM（Excel対応）
// ・認証は .env の FIREBASE_ADMIN_KEY_JSON または GOOGLE_APPLICATION_CREDENTIALS を使用

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { parse } = require("json2csv");
const admin = require("firebase-admin");
require("dotenv").config(); // .env を読み込む（なければ無視）

/** ─────────────────────────────────────────────
 * 認証情報の読み込み
 * 1) FIREBASE_ADMIN_KEY_JSON …… JSON文字列をそのまま
 * 2) GOOGLE_APPLICATION_CREDENTIALS …… JSONファイルのパス
 * 3) それ以外はエラー
 * private_key の \n → 改行 も補正
 * ──────────────────────────────────────────── */
function loadServiceAccount() {
  const inline = process.env.FIREBASE_ADMIN_KEY_JSON;
  if (inline) {
    const cred = JSON.parse(inline);
    if (cred.private_key?.includes("\\n")) {
      cred.private_key = cred.private_key.replace(/\\n/g, "\n");
    }
    return cred;
  }
  const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (gac) {
    const raw = fs.readFileSync(gac, "utf8");
    const cred = JSON.parse(raw);
    if (cred.private_key?.includes("\\n")) {
      cred.private_key = cred.private_key.replace(/\\n/g, "\n");
    }
    return cred;
  }
  throw new Error(
    "Service Account not found. Set FIREBASE_ADMIN_KEY_JSON or GOOGLE_APPLICATION_CREDENTIALS."
  );
}

/** Firebase Admin 初期化 */
(function initAdmin() {
  if (!admin.apps.length) {
    const sa = loadServiceAccount();
    admin.initializeApp({
      credential: admin.credential.cert(sa),
      projectId: sa.project_id || process.env.GCLOUD_PROJECT || undefined,
    });
  }
})();

const db = admin.firestore();

/** ─────────────────────────────────────────────
 * CLI引数
 *  --out <dir>     出力ディレクトリ（既定: カレント）
 *  --user <uid>    そのユーザーのタスクのみ
 *  --all           互換フラグ（指定しても挙動は同じ）
 *  例: node export-csv.js --all --out ./export
 * ──────────────────────────────────────────── */
function parseArgs(argv = process.argv.slice(2)) {
  const args = { out: ".", user: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") {
      args.out = argv[i + 1] || ".";
      i++;
    } else if (a === "--user") {
      args.user = argv[i + 1] || null;
      i++;
    } else if (a === "--all") {
      // 互換のため受け取るだけ（全件エクスポート）
    }
  }
  return args;
}

/** Date/Timestamp → ISO文字列（未定義なら ""） */
function toIso(v) {
  try {
    if (!v) return "";
    const d = v.toDate?.() ?? (v instanceof Date ? v : new Date(v));
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
    return d.toISOString();
  } catch {
    return "";
  }
}

(async () => {
  const opts = parseArgs();
  const outDir = path.resolve(process.cwd(), opts.out);
  fs.mkdirSync(outDir, { recursive: true });

  console.log("=== Firestore Export Start ===");
  console.log(` out:  ${outDir}`);
  if (opts.user) console.log(` user: ${opts.user}`);

  // クエリ組み立て
  let q = db.collection("todos");
  if (opts.user) q = q.where("userId", "==", opts.user);

  const snap = await q.get();

  const taskRows = [];
  const dailyRows = [];

  snap.forEach((docSnap) => {
    const t = docSnap.data() || {};
    const logs = t.actualLogs || {};

    // タスク台帳（1行/タスク）
    taskRows.push({
      taskId: docSnap.id,
      userId: t.userId || t.uid || "",
      text: t.text || "",
      createdAt: toIso(t.createdAt),
      deadline: toIso(t.deadline),
      eacDate: t.eacDate || "",
      estimatedMinutes: Number(t.estimatedMinutes ?? 0),
      actualTotalMinutes: Number(t.actualTotalMinutes ?? 0),
      completed: !!t.completed,
      labelId: t.labelId || "",
      priority: t.priority ?? "",
      spi: typeof t.spi === "number" ? t.spi : "",
      requiredPace: typeof t.requiredPace === "number" ? t.requiredPace : "",
      pace7d: typeof t.pace7d === "number" ? t.pace7d : "",
      riskLevel: t.riskLevel || "",
    });

    // 日次実績（actualLogsのみ展開）
    for (const [date, minutes] of Object.entries(logs)) {
      dailyRows.push({
        taskId: docSnap.id,
        userId: t.userId || t.uid || "",
        text: t.text || "",
        date, // YYYY-MM-DD
        actualMinutes: Number(minutes ?? 0),
        estimatedMinutes: Number(t.estimatedMinutes ?? 0),
        deadline: toIso(t.deadline),
        eacDate: t.eacDate || "",
        completed: !!t.completed,
      });
    }
  });

  // CSV出力（UTF-8 BOM）
  const csvOpts = { withBOM: true };
  const tasksCsv = parse(taskRows, csvOpts);
  const dailyCsv = parse(dailyRows, csvOpts);

  fs.writeFileSync(path.join(outDir, "tasks.csv"), tasksCsv, "utf8");
  fs.writeFileSync(path.join(outDir, "daily_progress.csv"), dailyCsv, "utf8");

  console.log(`✅ tasks.csv: ${taskRows.length} rows`);
  console.log(`✅ daily_progress.csv: ${dailyRows.length} rows`);
  console.log("=== Export Complete ===");
})().catch((err) => {
  console.error("❌ Export failed:", err);
  process.exit(1);
});
