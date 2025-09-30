// src/components/TodoList.jsx
import { useEffect, useState } from "react";
import { doc, deleteDoc, updateDoc, collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { useAuth } from "../hooks/useAuth";
import { format } from "date-fns";
import "./TodoList.css";
import {
  getDailyAssignments,
  todayKey,
  findAssignmentForDate,
  sumAssignmentMinutes,
  formatMinutes,
  formatAssignmentsSummary,
} from "../utils/calendarHelpers";

const priorityLabel = (v) => (v === 1 ? "低" : v === 3 ? "高" : "中");
// 不確実性ラベルは使わず、w（数値）をそのまま見せる運用に変更
// const uncertaintyLabel = (v) => ({ 1: "小", 2: "中", 3: "大", 4: "特大", 5: "超特大" }[v] || "未設定");

const toTime = (v) => v?.toDate?.()?.getTime?.() ?? null;

/** TE（修正版PERT）を計算。
 * 1) サーバ explain.TEw があればそれを**最優先**で表示
 * 2) 無ければローカルで O/P/w を使って概算（O/P 入力が無い時は M から近似）
 */
const calcTE = (t) => {
  // 1) サーバ結果を最優先（Cloud Functions の scheduleShift が計算）
  const TEw = t?.explain?.TEw;
  if (Number.isFinite(+TEw)) return +TEw;

  // 2) ローカル概算
  const M = Number.isFinite(+t?.estimatedMinutes) ? +t.estimatedMinutes : null;
  if (!M) return null;
  const w = Number.isFinite(+t?.pertWeight) ? +t.pertWeight : 4;
  const hasO = Number.isFinite(+t?.O);
  const hasP = Number.isFinite(+t?.P);
  const O = hasO ? Math.max(1, Math.round(+t.O)) : Math.round(M * 0.8);
  const P = hasP ? Math.max(O + 1, Math.round(+t.P)) : Math.max(O + 1, Math.round(M * 1.5));
  return (O + w * M + P) / (w + 2);
};

const SORT_OPTIONS = [
  { key: "createdAt", label: "登録順" },
  { key: "startRecommend", label: "通知順" },
  { key: "deadline", label: "締切順" },
];

function TodoList({
  todos,
  userId: userIdProp,
  onToggleDailyProgress,
  notificationMode = "justInTime",
}) {
  const { user } = useAuth();
  const userId = userIdProp || user?.uid;
  const [todayKeyValue] = useState(() => todayKey());

  const [sortBy, setSortBy] = useState("createdAt");
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(false);
  const [monthFilter, setMonthFilter] = useState("all");
  const [uncertaintyFilter, setUncertaintyFilter] = useState("all"); // 変数名はそのまま（互換維持）
  const [priorityFilter, setPriorityFilter] = useState("all");       // 変数名はそのまま（互換維持）
  const [labelFilter, setLabelFilter] = useState("all");

  // labels 購読
  const [labels, setLabels] = useState([]);
  useEffect(() => {
    if (!userId) return;
    const colRef = collection(db, "users", userId, "labels");
    const unsub = onSnapshot(colRef, (snap) => {
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...(d.data() ?? {}) }));
      setLabels(rows);
    });
    return () => unsub();
  }, [userId]);

  const getLabel = (labelId) => labels.find((l) => l.id === labelId) || null;

  // 月フィルタ候補
  const monthOptions = [...new Set(
    (todos ?? [])
      .map((t) => t.deadline?.toDate?.())
      .filter(Boolean)
      .map((d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)
  )].sort();

  // フィルタ
  const filtered = (todos ?? []).filter((t) => {
    if (showIncompleteOnly && t.completed) return false;

    if (monthFilter !== "all") {
      const d = t.deadline?.toDate?.();
      if (!d) return false;
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (ym !== monthFilter) return false;
    }

    if (uncertaintyFilter !== "all" && t.scale !== +uncertaintyFilter) return false; // scale は w 相当
    if (priorityFilter !== "all" && t.priority !== +priorityFilter) return false;    // priority は 重要度相当

    if (labelFilter !== "all" && t.labelId !== labelFilter) return false;

    return true;
  });

  // 並び替え
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "startRecommend")
      return (toTime(a.startRecommend) ?? Infinity) - (toTime(b.startRecommend) ?? Infinity);
    if (sortBy === "deadline")
      return (toTime(a.deadline) ?? Infinity) - (toTime(b.deadline) ?? Infinity);
    return 0;
  });

  const toggleDailyProgress = async (todoId, dateKey, nextValue) => {
    if (!dateKey) return;
    if (typeof onToggleDailyProgress === "function") {
      await onToggleDailyProgress(todoId, dateKey, nextValue);
      return;
    }
    try {
      await updateDoc(doc(db, "todos", todoId), {
        [`dailyProgress.${dateKey}`]: nextValue,
      });
    } catch (error) {
      console.error("toggle daily progress failed", error);
    }
  };

  return (
    <div>
      {/* 操作エリア */}
      <div className="list-controls">
        <div className="segmented">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              className={`seg-btn ${sortBy === opt.key ? "is-active" : ""}`}
              onClick={() => setSortBy(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <label className="switch">
          <input
            type="checkbox"
            checked={showIncompleteOnly}
            onChange={() => setShowIncompleteOnly((p) => !p)}
          />
          <span className="switch-track" />
          <span className="switch-label">未完のみ</span>
        </label>

        <div className="filter-row">
          {/* 月 */}
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="filter-select"
          >
            <option value="all">すべての月</option>
            {monthOptions.map((ym) => (
              <option key={ym} value={ym}>
                {ym.split("-")[0]}年{Number(ym.split("-")[1])}月
              </option>
            ))}
          </select>

          {/* ★ 不確実性 → w */}
          <select
            value={uncertaintyFilter}
            onChange={(e) => setUncertaintyFilter(e.target.value)}
            className="filter-select"
          >
            <option value="all">w: 全て</option>
            {[1, 2, 3, 4, 5].map((v) => (
              <option key={v} value={v}>w={v}</option>
            ))}
          </select>

          {/* ★ 優先度 → 重要度 */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="filter-select"
          >
            <option value="all">重要度: 全て</option>
            <option value={3}>高</option>
            <option value={2}>中</option>
            <option value={1}>低</option>
          </select>

          {/* ラベル */}
          <select
            value={labelFilter}
            onChange={(e) => setLabelFilter(e.target.value)}
            className="filter-select filter-select--label"
          >
            <option value="all">ラベル: 全て</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* リスト */}
      <ul className="list">
        {sorted.map((todo) => {
          const deadlineAt = todo.deadline?.toDate?.();
          const notifyAt   = todo.startRecommend?.toDate?.();
          const M  = Number(todo?.estimatedMinutes) || null;
          const TE = calcTE(todo);
          const TEh = Number.isFinite(TE) ? (TE / 60).toFixed(1) : null;

          const label = getLabel(todo.labelId);
          const borderColor = label?.color ?? "transparent";

          const assignments = getDailyAssignments(todo);
          const totalAssigned = sumAssignmentMinutes(assignments);
          const todayAssignment = findAssignmentForDate(assignments, todayKeyValue);
          const todayMinutes = todayAssignment?.minutes || 0;
          const todayDone = !!todo?.dailyProgress?.[todayKeyValue];
          const unallocated = Number.isFinite(Number(todo?.unallocatedMinutes))
            ? Math.max(0, Math.round(Number(todo.unallocatedMinutes)))
            : 0;
          const dailyLimit = Number.isFinite(Number(todo?.dailyMinutes))
            ? Math.max(0, Math.round(Number(todo.dailyMinutes)))
            : null;

          // O/P（任意入力があれば表示）
          const hasO = Number.isFinite(+todo?.O);
          const hasP = Number.isFinite(+todo?.P);
          const Ov = hasO ? Math.round(+todo.O) : null;
          const Pv = hasP ? Math.round(+todo.P) : null;

          return (
            <li key={todo.id} className="todo-item" style={{ borderColor }}>
              <div className="todo-content">
                <label className="todo-main">
                  <input
                    type="checkbox"
                    checked={todo.completed}
                    onChange={async () => {
                      const nextCompleted = !todo.completed;
                      const progressUpdate = {};
                      assignments.forEach((assignment) => {
                        if (!assignment?.date) return;
                        progressUpdate[`dailyProgress.${assignment.date}`] = nextCompleted;
                      });
                      try {
                        await updateDoc(doc(db, "todos", todo.id), {
                          completed: nextCompleted,
                          ...progressUpdate,
                        });
                      } catch (error) {
                        console.error("toggle todo complete failed", error);
                      }
                    }}
                  />
                  <span className={`todo-title ${todo.completed ? "is-done" : ""}`}>
                    {todo.text}
                  </span>
                  {label && (
                    <span
                      className="label-chip"
                      style={{ backgroundColor: label.color }}
                      title={label.name}
                    >
                      {label.name}
                    </span>
                  )}
                </label>

                <div className="meta-lines">
                  {/* 締切・通知 */}
                  <div className="meta-line">
                    <span className="meta-label">締切:</span>
                    <span className="meta-value">
                      {deadlineAt ? format(deadlineAt, "yyyy/M/d HH:mm") : "—"}
                    </span>
                    <span className="spacer" />
                    <span className="meta-label">通知:</span>
                    <span className="meta-value note">
                      {notifyAt ? format(notifyAt, "M/d HH:mm") : "—"}
                    </span>
                  </div>

                  {/* ★ w・重要度・M/O/P/TE */}
                  <div className="meta-line">
                    <span className="meta-label">w:</span>
                    <span className={`badge badge-scale-${todo.scale}`}>
                      {Number.isFinite(+todo.scale) ? String(+todo.scale) : "—"}
                    </span>

                    <span className="spacer" />
                    <span className="meta-label">重要度:</span>
                    <span className={`badge badge-priority-${todo.priority}`}>
                      {priorityLabel(todo.priority)}
                    </span>

                    <span className="spacer" />
                    <span className="meta-label">M:</span>
                    <span className="meta-value">{M ?? "—"} 分</span>

                    {hasO && (
                      <>
                        <span className="spacer" />
                        <span className="meta-label">O:</span>
                        <span className="meta-value">{Ov} 分</span>
                      </>
                    )}
                    {hasP && (
                      <>
                        <span className="spacer" />
                        <span className="meta-label">P:</span>
                        <span className="meta-value">{Pv} 分</span>
                      </>
                    )}

                    <span className="spacer" />
                    <span className="meta-label">TE:</span>
                    <span className="meta-value">
                      {Number.isFinite(TE) ? `${TE.toFixed(1)} 分（≒ ${TEh} 時間）` : "—"}
                    </span>
                  </div>

                  {assignments.length > 0 && (
                    <div className="meta-line meta-line--plan">
                      <span className="meta-label">日次割当:</span>
                      <span className="meta-value">
                        {formatAssignmentsSummary(assignments)}
                      </span>
                    </div>
                  )}

                  {notificationMode === "morningSummary" && (
                    <div className="meta-line meta-line--plan">
                      <span className="meta-label">今日:</span>
                      <label className="plan-check">
                        <input
                          type="checkbox"
                          disabled={!todayAssignment}
                          checked={todayAssignment ? todayDone : false}
                          onChange={(e) =>
                            toggleDailyProgress(todo.id, todayKeyValue, e.target.checked)
                          }
                        />
                        <span>
                          {todayAssignment
                            ? `${formatMinutes(todayMinutes)} 割当`
                            : "割当なし"}
                        </span>
                      </label>

                      <span className="spacer" />
                      <span className="meta-label">合計:</span>
                      <span className="meta-value">{formatMinutes(totalAssigned)}</span>

                      {dailyLimit != null && (
                        <>
                          <span className="spacer" />
                          <span className="meta-label">1日上限:</span>
                          <span className="meta-value">{formatMinutes(dailyLimit)}</span>
                        </>
                      )}

                      {unallocated > 0 && (
                        <>
                          <span className="spacer" />
                          <span className="meta-label">未割当:</span>
                          <span className="meta-value text-red-600">
                            {formatMinutes(unallocated)}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <button
                className="icon-btn delete-btn"
                onClick={() => deleteDoc(doc(db, "todos", todo.id))}
                title="削除"
              >
                🗑️
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default TodoList;
