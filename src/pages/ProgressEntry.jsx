// src/pages/ProgressEntry.jsx
import { useMemo, useState } from "react";
import { format, addDays } from "date-fns";
import {
  doc,
  updateDoc,
  serverTimestamp,
  addDoc,
  collection,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import LogEditorModal from "../components/LogEditorModal";
import { applyLogDiff, jstDateKey } from "../utils/logUpdates";

const toDate = (v) => v?.toDate?.() ?? (v instanceof Date ? v : null);

function percent(n) {
  if (!Number.isFinite(n)) return "—";
  const p = Math.max(0, Math.min(1, n)) * 100;
  return `${p.toFixed(0)}%`;
}

const parseDateKey = (key) => {
  if (!key) return null;
  const [y, m, d] = key.split("-").map((part) => Number(part));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m - 1, d);
};

const AddMissingLogModal = ({ open, onClose, todos, dateKey }) => {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [minutes, setMinutes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const candidates = useMemo(() => {
    if (!open) return [];
    const key = dateKey;
    const sanitized = (todos || []).filter((t) => {
      const val = Math.max(0, Math.round(Number(t?.actualLogs?.[key]) || 0));
      return val <= 0;
    });
    if (!search.trim()) return sanitized;
    const q = search.trim().toLowerCase();
    return sanitized.filter((t) => t.text?.toLowerCase?.().includes(q));
  }, [todos, dateKey, search, open]);

  const reset = () => {
    setSearch("");
    setSelectedId("");
    setMinutes("");
    setError("");
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose?.();
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (saving) return;
    if (!selectedId) {
      setError("タスクを選択してください。");
      return;
    }
    const minutesValue = Math.round(Number(minutes));
    if (!Number.isFinite(minutesValue) || minutesValue <= 0) {
      setError("分数は1以上を入力してください。");
      return;
    }
    const target = todos.find((t) => t.id === selectedId);
    if (!target) {
      setError("選択したタスクが見つかりません。");
      return;
    }
    const oldValue = Math.max(0, Math.round(Number(target?.actualLogs?.[dateKey]) || 0));
    const newValue = oldValue + minutesValue;
    const total = Math.round(Number(target?.actualTotalMinutes) || 0);
    if (total + (newValue - oldValue) < 0) {
      setError("累積実績が負になるため追加できません。");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await applyLogDiff({
        todoId: target.id,
        dateKey,
        newValue,
        oldValue,
        actualTotalMinutes: target.actualTotalMinutes,
        source: "manual",
        trigger: "progress-entry/add-missing",
      });
      alert("保存しました");
      reset();
      onClose?.();
    } catch (err) {
      console.error("add missing log failed", err);
      setError(err?.message || "保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const overlayStyle = {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.45)",
    zIndex: 1050,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  };

  const modalStyle = {
    width: "min(480px, 100%)",
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 20px 40px rgba(15,23,42,0.18)",
    padding: 20,
    color: "#0f172a",
  };

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #cbd5f5",
    fontSize: 15,
    boxSizing: "border-box",
  };

  return (
    <div style={overlayStyle} onMouseDown={handleClose}>
      <div
        style={modalStyle}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>未作業タスクを追加</h3>
          <button
            type="button"
            onClick={handleClose}
            style={{
              border: "1px solid #cbd5f5",
              background: "#f8fafc",
              borderRadius: 8,
              padding: "6px 10px",
              cursor: "pointer",
            }}
          >
            閉じる
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ marginTop: 16, display: "grid", gap: 14 }}>
          <div>
            <label htmlFor="add-missing-search" style={{ display: "block", fontSize: 13, color: "#475569", marginBottom: 6 }}>
              タスクを検索
            </label>
            <input
              id="add-missing-search"
              type="search"
              placeholder="タスク名で検索"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div>
            <label htmlFor="add-missing-select" style={{ display: "block", fontSize: 13, color: "#475569", marginBottom: 6 }}>
              対象タスク
            </label>
            <select
              id="add-missing-select"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              style={{ ...inputStyle, paddingRight: 32 }}
            >
              <option value="">選択してください</option>
              {candidates.map((todo) => (
                <option key={todo.id} value={todo.id}>
                  {todo.text}
                </option>
              ))}
            </select>
            <p style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
              この日に未記録のタスクから選択します。
            </p>
          </div>

          <div>
            <label htmlFor="add-missing-minutes" style={{ display: "block", fontSize: 13, color: "#475569", marginBottom: 6 }}>
              追加する分数
            </label>
            <input
              id="add-missing-minutes"
              type="number"
              min={1}
              step={1}
              placeholder="例: 45"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              style={inputStyle}
            />
          </div>

          {error ? (
            <p style={{ margin: 0, color: "#dc2626", fontSize: 13 }}>{error}</p>
          ) : null}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button
              type="button"
              onClick={handleClose}
              style={{
                border: "1px solid #cbd5f5",
                background: "#f8fafc",
                color: "#1e293b",
                borderRadius: 10,
                padding: "8px 16px",
                cursor: saving ? "default" : "pointer",
              }}
              disabled={saving}
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                border: "none",
                background: "#2563eb",
                color: "#fff",
                borderRadius: 10,
                padding: "10px 18px",
                cursor: saving ? "default" : "pointer",
                fontWeight: 600,
              }}
            >
              {saving ? "保存中…" : "追加"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/**
 * 進捗入力ページ：
 *  - 今日取り組んだ分をタスクごとに入力 → 一括保存
 *  - 保存は actualTotalMinutes に加算 + その日のログ actualLogs.{YYYY-MM-DD} にも加算
 *  - さらに todos/{taskId}/sessions/{autoId} に明細イベントを1件追記（研究用）
 */
export default function ProgressEntry({ todos = [], src }) {
  const today = new Date();
  const todayKey = jstDateKey(today);

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
          date: todayKey, // YYYY-MM-DD
          minutes: addMin, // 今回追加分（分）
          source: "manual", // UIからの入力

          trigger: src || "manual", // 通知経由で来た場合は 'morningSummary' 等に変更する
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

  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);

  const workedTodos = useMemo(() => {
    const list = (todos || []).map((t) => {
      const minutes = Math.max(
        0,
        Math.round(Number(t?.actualLogs?.[selectedDateKey]) || 0)
      );
      return { ...t, minutes };
    });
    return list
      .filter((t) => t.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes);
  }, [todos, selectedDateKey]);

  const [editorState, setEditorState] = useState({ open: false, todo: null, date: null });
  const [missingModalOpen, setMissingModalOpen] = useState(false);

  const openEditor = (todo, dateKey) => {
    if (!todo) return;
    setEditorState({ open: true, todo, date: dateKey });
  };

  const closeEditor = () => {
    setEditorState({ open: false, todo: null, date: null });
  };

  const moveSelectedDate = (offset) => {
    const base = parseDateKey(selectedDateKey) ?? new Date();
    const next = addDays(base, offset);
    setSelectedDateKey(jstDateKey(next));
  };

  return (
    <main className="app-main">
      <div className="container" style={{ display: "grid", gap: 20 }}>
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

        <section className="card" style={{ padding: 16 }}>
          <header style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>日別ログ編集</h2>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => moveSelectedDate(-1)}
                style={{
                  border: "1px solid #cbd5f5",
                  background: "#f8fafc",
                  borderRadius: 8,
                  padding: "6px 10px",
                  cursor: "pointer",
                }}
              >
                ← 前日
              </button>
              <input
                type="date"
                value={selectedDateKey}
                onChange={(e) => setSelectedDateKey(e.target.value)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #cbd5f5",
                  fontSize: 15,
                }}
              />
              <button
                type="button"
                onClick={() => moveSelectedDate(1)}
                style={{
                  border: "1px solid #cbd5f5",
                  background: "#f8fafc",
                  borderRadius: 8,
                  padding: "6px 10px",
                  cursor: "pointer",
                }}
              >
                翌日 →
              </button>
              <button
                type="button"
                onClick={() => setSelectedDateKey(todayKey)}
                style={{
                  border: "none",
                  background: "#2563eb",
                  color: "#fff",
                  borderRadius: 8,
                  padding: "6px 14px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                今日に戻る
              </button>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "#475569" }}>
              選択した日付の実績ログを編集・削除できます。ログのないタスクを追加することもできます。
            </p>
          </header>

          <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
            {workedTodos.length === 0 ? (
              <p style={{ color: "#64748b", margin: 0 }}>
                この日はまだログがありません。下の「未作業タスクを検索して追加」から登録できます。
              </p>
            ) : (
              workedTodos.map((todo) => {
                const deadline = toDate(todo.deadline);
                return (
                  <div
                    key={todo.id}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 12,
                      padding: 14,
                      background: "#fff",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{todo.text}</div>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                          この日の実績: {todo.minutes} 分
                          {deadline ? ` ｜ 締切: ${format(deadline, "yyyy/MM/dd HH:mm")}` : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => openEditor(todo, selectedDateKey)}
                        style={{
                          border: "none",
                          background: "#2563eb",
                          color: "#fff",
                          borderRadius: 8,
                          padding: "8px 14px",
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        編集
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div style={{ marginTop: 20 }}>
            <button
              type="button"
              onClick={() => setMissingModalOpen(true)}
              style={{
                border: "1px solid #2563eb",
                background: "#fff",
                color: "#2563eb",
                borderRadius: 10,
                padding: "10px 18px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              未作業タスクを検索して追加
            </button>
          </div>
        </section>
      </div>

      <LogEditorModal
        open={editorState.open}
        onClose={closeEditor}
        todo={editorState.todo}
        defaultDate={editorState.date}
      />

      <AddMissingLogModal
        open={missingModalOpen}
        onClose={() => setMissingModalOpen(false)}
        todos={todos}
        dateKey={selectedDateKey}
      />
    </main>
  );
}
