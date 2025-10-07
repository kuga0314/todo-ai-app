// src/pages/ProgressEntry.jsx
import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  doc,
  updateDoc,
  serverTimestamp,
  addDoc,
  collection,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";

const toDate = (v) => v?.toDate?.() ?? (v instanceof Date ? v : null);

function percent(n) {
  if (!Number.isFinite(n)) return "—";
  const p = Math.max(0, Math.min(1, n)) * 100;
  return `${p.toFixed(0)}%`;
}

function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * 進捗入力ページ：
 *  - 今日取り組んだ分をタスクごとに入力 → 一括保存
 *  - 保存は actualTotalMinutes に加算 + その日のログ actualLogs.{YYYY-MM-DD} にも加算
 *  - さらに todos/{taskId}/sessions/{autoId} に明細イベントを1件追記（研究用）
 */
export default function ProgressEntry({ todos = [] }) {
  const today = new Date();
  const todayKey = dateKey(today);

  // 表示対象：未完了 && 残り>0 を基本に、締切昇順で並べる（締切なしは最後）
  const rows = useMemo(() => {
    const list = (todos || []).map((t) => {
      const E = Number(t.estimatedMinutes) || 0;
      const A = Number(t.actualTotalMinutes) || 0;
      const remaining = Math.max(0, E - A);
      const deadline = toDate(t.deadline);
      return { ...t, E, A, remaining, deadline };
    });
    return list
      .filter((t) => !t.completed && t.remaining > 0)
      .sort((a, b) => {
        const da = a.deadline ? a.deadline.getTime() : Infinity;
        const db = b.deadline ? b.deadline.getTime() : Infinity;
        return da - db;
      });
  }, [todos]);

  // 入力値（分）を保持
  const [inputs, setInputs] = useState({}); // { [todoId]: "30" }
  const [saving, setSaving] = useState(false);

  const totalEntered = useMemo(
    () =>
      Object.values(inputs).reduce((acc, v) => {
        const n = Math.round(Number(v));
        return acc + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0),
    [inputs]
  );

  const handleChange = (id, v) => {
    setInputs((m) => ({ ...m, [id]: v }));
  };

  const saveAll = async () => {
    if (saving) return;
    const targets = rows.filter((r) => {
      const n = Math.round(Number(inputs[r.id]));
      return Number.isFinite(n) && n > 0;
    });
    if (targets.length === 0) return;

    setSaving(true);
    try {
      const ops = targets.map(async (t) => {
        const addMin = Math.round(Number(inputs[t.id]));
        const cur = Number.isFinite(Number(t.actualTotalMinutes))
          ? Number(t.actualTotalMinutes)
          : 0;

        // ① 実績を加算 & 日別ログに累積
        await updateDoc(doc(db, "todos", t.id), {
          actualTotalMinutes: cur + addMin,
          [`actualLogs.${todayKey}`]:
            (Number(t?.actualLogs?.[todayKey]) || 0) + addMin,
          lastProgressAt: serverTimestamp(), // 監査用
        });

        // ② 実績イベントを sessions に1件追記（研究用の明細）
        await addDoc(collection(db, "todos", t.id, "sessions"), {
          date: todayKey,            // YYYY-MM-DD
          minutes: addMin,           // 今回追加分（分）
          source: "manual",          // UIからの入力
          trigger: "none",           // 通知経由で来た場合は 'morningSummary' 等に変更する
          createdAt: serverTimestamp(),
        });
      });

      await Promise.all(ops);
      setInputs({});
      alert("保存しました！");
    } catch (e) {
      console.error(e);
      alert("保存に失敗しました。通信状況をご確認ください。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="app-main">
      <div className="container">
        <section className="card" style={{ padding: 16 }}>
          <header style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>進捗入力</h2>
            <p style={{ margin: "6px 0 0", color: "#666", fontSize: 13 }}>
              {format(today, "yyyy/M/d (EEE)")} に取り組んだ時間を入力し、「一括保存」を押してください。
            </p>
          </header>

          {rows.length === 0 ? (
            <p style={{ color: "#666" }}>入力対象のタスクはありません。</p>
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "grid",
                gap: 10,
              }}
            >
              {rows.map((t) => {
                const prog = t.E ? t.A / t.E : null;
                return (
                  <li
                    key={t.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 140px 110px",
                      gap: 10,
                      alignItems: "center",
                      padding: "10px 12px",
                      border: "1px solid #eee",
                      borderRadius: 10,
                      background: "#fff",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={t.text}
                      >
                        {t.text}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "#666",
                          marginTop: 2,
                          display: "flex",
                          gap: 10,
                        }}
                      >
                        <span>
                          締切: {t.deadline ? format(t.deadline, "M/d HH:mm") : "—"}
                        </span>
                        <span>E: {t.E}分</span>
                        <span>実績: {t.A}分</span>
                        <span>進捗: {prog != null ? percent(prog) : "—"}</span>
                        <span>残り: {t.remaining}分</span>
                      </div>
                    </div>

                    <input
                      type="number"
                      min={1}
                      step={1}
                      placeholder="例: 30"
                      value={inputs[t.id] ?? ""}
                      onChange={(e) => handleChange(t.id, e.target.value)}
                      style={{
                        padding: 8,
                        border: "1px solid #ddd",
                        borderRadius: 8,
                      }}
                    />

                    <div
                      style={{
                        textAlign: "right",
                        color: "#333",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      今日の合計:{" "}
                      {Number.isFinite(Number(inputs[t.id]))
                        ? `${Math.max(0, Math.round(Number(inputs[t.id])))} 分`
                        : "—"}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 14,
            }}
          >
            <div style={{ color: "#666", fontSize: 13 }}>
              入力合計: <b>{totalEntered}</b> 分
            </div>
            <button
              onClick={saveAll}
              disabled={saving || totalEntered <= 0}
              className="btn-primary"
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                background: totalEntered > 0 ? "#2563eb" : "#9ca3af",
                color: "#fff",
                border: "none",
                cursor: totalEntered > 0 && !saving ? "pointer" : "default",
              }}
            >
              {saving ? "保存中…" : "一括保存"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
