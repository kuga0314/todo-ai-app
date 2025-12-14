// src/components/TaskDetailModal.jsx
import { useEffect, useMemo, useState } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { addDays, format } from "date-fns";
import { db } from "../firebase/firebaseConfig";
import "./TodoList.css";
import { logTodoHistory } from "../utils/todoHistory";
import { buildDateRange, formatDateKey, parseDateKey } from "../utils/analytics";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const toDateValue = (v) => {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v.toDate === "function") return v.toDate();
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

function percent(n) {
  if (!Number.isFinite(n)) return "—";
  const p = Math.max(0, Math.min(1, n)) * 100;
  return `${p.toFixed(0)}%`;
}

export default function TaskDetailModal({ todo, labels = [], onClose }) {
  const [savingLabel, setSavingLabel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [labelValue, setLabelValue] = useState(todo?.labelId ?? "");
  const [titleValue, setTitleValue] = useState(todo?.text ?? "");
  const [deadlineValue, setDeadlineValue] = useState(() => {
    const d = toDateValue(todo?.deadline);
    return d ? format(d, "yyyy-MM-dd'T'HH:mm") : "";
  });

  useEffect(() => {
    setLabelValue(todo?.labelId ?? "");
    setTitleValue(todo?.text ?? "");
    const d = toDateValue(todo?.deadline);
    setDeadlineValue(d ? format(d, "yyyy-MM-dd'T'HH:mm") : "");
  }, [todo]);

  const decorated = useMemo(() => {
    if (!todo) return null;

    const deadlineAt = todo.deadline?.toDate?.() ?? toDateValue(todo.deadline);
    const plannedStartAt = toDateValue(todo.plannedStart);
    const estimatedMinutes = Number.isFinite(Number(todo.estimatedMinutes))
      ? Number(todo.estimatedMinutes)
      : null;
    const actualMinutes = Number.isFinite(Number(todo.actualTotalMinutes))
      ? Math.max(0, Math.round(Number(todo.actualTotalMinutes)))
      : 0;
    const progressRatio = estimatedMinutes
      ? actualMinutes / estimatedMinutes
      : null;
    const remainingMinutes = estimatedMinutes != null
      ? Math.max(0, estimatedMinutes - actualMinutes)
      : null;

    return {
      deadlineAt,
      plannedStartAt,
      estimatedMinutes,
      actualMinutes,
      progressRatio,
      remainingMinutes,
    };
  }, [todo]);

  const chartData = useMemo(() => {
    if (!todo || !decorated) return { series: [], hasLogs: false };

    const logs = todo.actualLogs || {};
    const sortedLogKeys = Object.keys(logs)
      .filter((key) => Number.isFinite(Number(logs[key])))
      .sort();

    const plannedStartKey = decorated.plannedStartAt
      ? formatDateKey(decorated.plannedStartAt)
      : null;
    const deadlineKey = decorated.deadlineAt ? formatDateKey(decorated.deadlineAt) : null;
    const earliestLogKey = sortedLogKeys[0] || null;
    const latestLogKey = sortedLogKeys[sortedLogKeys.length - 1] || null;

    const startKey = plannedStartKey || earliestLogKey || deadlineKey;
    const endKey = (() => {
      if (deadlineKey && latestLogKey) {
        return deadlineKey > latestLogKey ? deadlineKey : latestLogKey;
      }
      return deadlineKey || latestLogKey || startKey;
    })();

    if (!startKey || !endKey) return { series: [], hasLogs: false };

    const range = buildDateRange(startKey, endKey);
    if (!range.length) return { series: [], hasLogs: false };

    const estimated = Number(todo.estimatedMinutes) || 0;
    const deadline = decorated.deadlineAt || null;

    const calcPace7 = (index) => {
      const startIdx = Math.max(0, index - 6);
      let sum = 0;
      let daysWorked = 0;
      for (let i = startIdx; i <= index; i += 1) {
        const key = range[i];
        const value = Number(logs[key]) || 0;
        sum += value;
        if (value > 0) daysWorked += 1;
      }
      const denominator = Math.max(1, daysWorked < 3 ? daysWorked || 1 : 7);
      return sum / denominator;
    };

    let cumulative = 0;
    const series = range.map((dateKey, index) => {
      const minutes = Number(logs[dateKey]) || 0;
      cumulative += minutes;
      const remaining = Math.max(0, estimated - cumulative);
      const pace7 = calcPace7(index);

      let eacTs = null;
      if (pace7 > 0 && remaining > 0) {
        const currentDate = parseDateKey(dateKey);
        if (currentDate && !Number.isNaN(currentDate.getTime())) {
          eacTs = addDays(currentDate, Math.ceil(remaining / pace7))?.getTime?.() ?? null;
        }
      }

      let spi = null;
      if (deadline) {
        const currentDate = parseDateKey(dateKey);
        const msLeft = currentDate ? deadline.getTime() - currentDate.getTime() : 0;
        const daysLeft = Math.max(1, Math.ceil(msLeft / 86400000));
        const required = remaining > 0 ? remaining / daysLeft : 0;
        if (required > 0) {
          const raw = pace7 / required;
          spi = Number.isFinite(raw) ? Number(raw.toFixed(2)) : null;
        } else {
          spi = remaining === 0 ? 1 : 0;
        }
      }

      return {
        date: dateKey,
        minutes,
        cum: cumulative,
        remaining,
        eacTs,
        spi,
      };
    });

    const hasLogs = series.some((item) => Number(item.minutes) > 0 || Number(item.cum) > 0);
    return { series, hasLogs };
  }, [decorated, todo]);

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose?.();
  };

  const handleDelete = async () => {
    if (!todo) return;
    if (!window.confirm("このタスクを削除します。よろしいですか？")) return;

    try {
      setDeleting(true);
      const updates = {
        deleted: true,
        deletedAt: serverTimestamp(),
      };
      await updateDoc(doc(db, "todos", todo.id), updates);
      await logTodoHistory(todo, updates, "soft-delete-from-calendar");
      onClose?.();
    } catch (error) {
      console.error("delete from calendar failed", error);
      alert("タスクの削除に失敗しました。通信環境を確認してください。");
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveLabel = async () => {
    if (!todo) return;
    if (labelValue === (todo.labelId ?? "")) return;

    try {
      setSavingLabel(true);
      const nextValue = labelValue || null;
      await updateDoc(doc(db, "todos", todo.id), { labelId: nextValue });
      await logTodoHistory(todo, { labelId: nextValue }, "update-label-from-calendar");
    } catch (error) {
      console.error("update label failed", error);
      alert("ラベルの更新に失敗しました。通信環境を確認してください。");
    } finally {
      setSavingLabel(false);
    }
  };

  const handleSaveDetails = async () => {
    if (!todo) return;

    const trimmedTitle = titleValue.trim();
    if (!trimmedTitle) {
      alert("タイトルを入力してください。");
      return;
    }

    const nextDeadline = deadlineValue ? new Date(deadlineValue) : null;
    if (deadlineValue && Number.isNaN(nextDeadline?.getTime?.())) {
      alert("締切の日時が正しくありません。");
      return;
    }

    const currentDeadline = toDateValue(todo.deadline);
    const currentDeadlineTime = currentDeadline?.getTime?.() ?? null;
    const nextDeadlineTime = nextDeadline?.getTime?.() ?? null;

    const updates = {};
    if (trimmedTitle !== todo.text) {
      updates.text = trimmedTitle;
    }
    if (currentDeadlineTime !== nextDeadlineTime) {
      updates.deadline = nextDeadline || null;
    }

    if (!Object.keys(updates).length) return;

    try {
      setSavingDetails(true);
      await updateDoc(doc(db, "todos", todo.id), updates);
      await logTodoHistory(todo, updates, "update-task-detail-from-calendar");
    } catch (error) {
      console.error("update task detail failed", error);
      alert("タスクの更新に失敗しました。通信環境を確認してください。");
    } finally {
      setSavingDetails(false);
    }
  };

  if (!todo || !decorated) return null;

  const overlayStyle = {
    position: "absolute",
    inset: 0,
    background: "rgba(0,0,0,0.25)",
    zIndex: 1200,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  };

  return (
    <div className="task-modal-overlay" style={overlayStyle} onMouseDown={handleBackdropClick}>
      <div
        className="card task-modal-card"
        style={{
          position: "relative",
          width: "min(920px, 100%)",
          maxHeight: "min(85vh, 820px)",
          overflowY: "auto",
          padding: 20,
          background: "#f8fafc",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 14,
            paddingBottom: 10,
            borderBottom: "1px solid #e2e8f0",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
            <input type="checkbox" checked={!!todo.completed} readOnly />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                {todo.labelId && (
                  <span
                    className="label-pill"
                    style={{
                      background: labels.find((l) => l.id === todo.labelId)?.color || "#64748b",
                      color: "#fff",
                      padding: "4px 12px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 700,
                      lineHeight: 1.1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {labels.find((l) => l.id === todo.labelId)?.name || "ラベル"}
                  </span>
                )}
                <strong style={{ fontSize: "1.05rem", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {titleValue || todo.text}
                </strong>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ color: "#475569", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: 700 }}>締切</span>
                  {decorated.deadlineAt ? format(decorated.deadlineAt, "yyyy/M/d HH:mm") : "—"}
                </span>
                <span style={{ color: "#475569", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: 700 }}>開始予定</span>
                  {decorated.plannedStartAt ? format(decorated.plannedStartAt, "yyyy/M/d") : "—"}
                </span>
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn-mini">
            閉じる
          </button>
        </header>

        <div
          className="todo-item"
          style={{
            borderLeft: "6px solid #cbd5e1",
            boxShadow: "0 6px 16px rgba(0,0,0,0.08)",
            marginBottom: 14,
            padding: 14,
            background: "#fff",
          }}
        >
          <div
            className="todo-content"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(420px, 1fr) minmax(320px, 0.9fr)",
              gap: 16,
              alignItems: "start",
            }}
          >
            <div className="todo-main" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>ラベル</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <select
                    id="calendar-label-select"
                    value={labelValue}
                    onChange={(e) => setLabelValue(e.target.value)}
                    className="filter-select"
                    style={{ minWidth: 200 }}
                  >
                    <option value="">（ラベルなし）</option>
                    {labels.map((lb) => (
                      <option key={lb.id} value={lb.id}>
                        {lb.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn-mini"
                    disabled={savingLabel || labelValue === (todo.labelId ?? "")}
                    onClick={handleSaveLabel}
                    type="button"
                  >
                    {savingLabel ? "保存中…" : "ラベルを更新"}
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>タイトル</label>
                <input
                  type="text"
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  style={{
                    width: "100%",
                    border: "1px solid #cbd5e1",
                    borderRadius: 10,
                    padding: "10px 12px",
                    fontSize: 15,
                    background: "#f8fafc",
                  }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>締切</label>
                <input
                  type="datetime-local"
                  value={deadlineValue}
                  onChange={(e) => setDeadlineValue(e.target.value)}
                  style={{
                    border: "1px solid #cbd5e1",
                    borderRadius: 10,
                    padding: "8px 10px",
                    fontSize: 14,
                    background: "#f8fafc",
                  }}
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 10,
                  padding: "10px 12px",
                  background: "#f8fafc",
                  borderRadius: 10,
                  border: "1px solid #e2e8f0",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="meta-label">予定時間</span>
                  <span className="meta-value">{decorated.estimatedMinutes != null ? `${decorated.estimatedMinutes} 分` : "—"}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="meta-label">実績</span>
                  <span className="meta-value">{`${decorated.actualMinutes ?? 0} 分`}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="meta-label">進捗率</span>
                  <span className="meta-value">{percent(decorated.progressRatio)}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="meta-label">残り</span>
                  <span className="meta-value">
                    {decorated.remainingMinutes != null ? `${decorated.remainingMinutes} 分` : "—"}
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end" }}>
                <button
                  className="btn"
                  onClick={handleSaveDetails}
                  disabled={savingDetails || (!titleValue.trim() && !deadlineValue)}
                  type="button"
                >
                  {savingDetails ? "更新中…" : "タイトル・締切を更新"}
                </button>

                <button
                  className="icon-btn delete-btn"
                  onClick={handleDelete}
                  disabled={deleting}
                  title="削除"
                >
                  {deleting ? "削除中…" : "🗑️"}
                </button>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateRows: "1fr 1fr",
                gap: 12,
                minHeight: 320,
              }}
            >
              <div
                style={{
                  padding: 10,
                  background: "#f8fafc",
                  borderRadius: 10,
                  border: "1px solid #e2e8f0",
                }}
              >
                <p style={{ margin: "0 0 8px", fontWeight: 700, color: "#334155", fontSize: 13 }}>
                  日別実績 / SPI
                </p>
                {chartData.series.length ? (
                  <div style={{ height: 160 }}>
                    <ResponsiveContainer>
                      <ComposedChart data={chartData.series} margin={{ left: 6, right: 24, top: 6, bottom: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} angle={-25} textAnchor="end" height={60} />
                        <YAxis
                          yAxisId="left"
                          tick={{ fontSize: 11 }}
                          label={{ value: "分", angle: -90, position: "insideLeft", style: { textAnchor: "middle" } }}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          tick={{ fontSize: 11 }}
                          domain={[0, 1.5]}
                          label={{ value: "SPI", angle: 90, position: "insideRight", style: { textAnchor: "middle" } }}
                        />
                        <Tooltip
                          formatter={(value, _name, entry) => {
                            const key = entry?.dataKey || _name;
                            if (key === "minutes") return [`${value} 分`, "日別実績"];
                            if (key === "cum") return [`${value} 分`, "累積実績"];
                            if (key === "spi") return [value ?? "—", "SPI"];
                            return value;
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar yAxisId="left" dataKey="minutes" name="日別実績(分)" fill="#38bdf8" />
                        <Line yAxisId="left" type="monotone" dataKey="cum" name="累積実績(分)" stroke="#f97316" strokeWidth={2} dot={false} />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="spi"
                          name="SPI"
                          stroke="#10b981"
                          strokeWidth={2}
                          dot={false}
                          strokeDasharray="3 3"
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>ログがありません</p>
                )}
              </div>

              <div
                style={{
                  padding: 10,
                  background: "#f8fafc",
                  borderRadius: 10,
                  border: "1px solid #e2e8f0",
                }}
              >
                <p style={{ margin: "0 0 8px", fontWeight: 700, color: "#334155", fontSize: 13 }}>
                  残り時間 / EAC予測
                </p>
                {chartData.series.length ? (
                  <div style={{ height: 160 }}>
                    <ResponsiveContainer>
                      <ComposedChart data={chartData.series} margin={{ left: 6, right: 24, top: 6, bottom: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} angle={-25} textAnchor="end" height={60} />
                        <YAxis
                          yAxisId="left"
                          tick={{ fontSize: 11 }}
                          label={{ value: "残り(分)", angle: -90, position: "insideLeft", style: { textAnchor: "middle" } }}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          tick={{ fontSize: 11 }}
                          domain={["dataMin", "dataMax"]}
                          tickFormatter={(value) => (value ? format(new Date(value), "MM/dd") : "—")}
                          label={{ value: "EAC予測日", angle: 90, position: "insideRight", style: { textAnchor: "middle" } }}
                        />
                        <Tooltip
                          formatter={(value, _name, entry) => {
                            const key = entry?.dataKey || _name;
                            if (key === "remaining") return [`残り: ${value} 分`, "残り作業"];
                            if (key === "eacTs") {
                              if (value == null) return ["—", "EAC予測日"];
                              return [format(new Date(value), "yyyy-MM-dd"), "EAC予測日"];
                            }
                            return value;
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Line yAxisId="left" type="monotone" dataKey="remaining" name="残り(分)" stroke="#6366f1" strokeWidth={2} dot />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="eacTs"
                          name="EAC予測日"
                          stroke="#ef4444"
                          strokeWidth={2}
                          dot={false}
                          strokeDasharray="4 2"
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>ログがありません</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
