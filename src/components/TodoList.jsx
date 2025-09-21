// src/components/TodoList.jsx
import { useEffect, useState } from "react";
import { doc, deleteDoc, updateDoc, collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { useAuth } from "../hooks/useAuth";
import { format } from "date-fns";
import "./TodoList.css";

const priorityLabel = (v) => (v === 1 ? "低" : v === 3 ? "高" : "中");
const uncertaintyLabel = (v) =>
  ({ 1: "小", 2: "中", 3: "大", 4: "特大", 5: "超特大" }[v] || "未設定");
const toTime = (v) => v?.toDate?.()?.getTime?.() ?? null;

const calcTE = (todo) => {
  const w = Number.isFinite(+todo?.pertWeight) ? +todo.pertWeight : 4;
  const M = Number.isFinite(+todo?.estimatedMinutes) ? +todo.estimatedMinutes : null;
  if (!M) return null;
  const O = 0.8 * M;
  const P = 1.5 * M;
  return (O + w * M + P) / (w + 2);
};

const SORT_OPTIONS = [
  { key: "createdAt", label: "登録順" },
  { key: "startRecommend", label: "通知順" },
  { key: "deadline", label: "締切順" },
];

function TodoList({ todos, userId: userIdProp }) {
  const { user } = useAuth();
  const userId = userIdProp || user?.uid;

  const [sortBy, setSortBy] = useState("createdAt");
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(false);
  const [monthFilter, setMonthFilter] = useState("all");
  const [uncertaintyFilter, setUncertaintyFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [labelFilter, setLabelFilter] = useState("all"); // ★ ラベル

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

    if (uncertaintyFilter !== "all" && t.scale !== +uncertaintyFilter) return false;
    if (priorityFilter !== "all" && t.priority !== +priorityFilter) return false;

    // ★ ラベルフィルタ
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

          {/* 不確実性 */}
          <select
            value={uncertaintyFilter}
            onChange={(e) => setUncertaintyFilter(e.target.value)}
            className="filter-select"
          >
            <option value="all">不確実性: 全て</option>
            {[1,2,3,4,5].map((v) => (
              <option key={v} value={v}>{uncertaintyLabel(v)}</option>
            ))}
          </select>

          {/* 優先度 */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="filter-select"
          >
            <option value="all">優先度: 全て</option>
            <option value={3}>高</option>
            <option value={2}>中</option>
            <option value={1}>低</option>
          </select>

          {/* ★ ラベル（優先度の隣に移動） */}
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
          const E  = Number(todo?.estimatedMinutes) || null;
          const TE = calcTE(todo);
          const TEh = TE ? (TE / 60).toFixed(1) : null;

          const label = getLabel(todo.labelId);
          const borderColor = label?.color ?? "transparent";

          return (
            <li key={todo.id} className="todo-item" style={{ borderColor }}>
              <div className="todo-content">
                <label className="todo-main">
                  <input
                    type="checkbox"
                    checked={todo.completed}
                    onChange={() =>
                      updateDoc(doc(db, "todos", todo.id), { completed: !todo.completed })
                    }
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

                  <div className="meta-line">
                    <span className="meta-label">規模:</span>
                    <span className={`badge badge-scale-${todo.scale}`}>
                      {uncertaintyLabel(todo.scale)}
                    </span>
                    <span className="spacer" />
                    <span className="meta-label">優先度:</span>
                    <span className={`badge badge-priority-${todo.priority}`}>
                      {priorityLabel(todo.priority)}
                    </span>
                    <span className="spacer" />
                    <span className="meta-label">E:</span>
                    <span className="meta-value">{E ?? "—"} 分</span>
                    <span className="spacer" />
                    <span className="meta-label">TE:</span>
                    <span className="meta-value">
                      {TE ? `${TE.toFixed(1)} 分（≒ ${TEh} 時間）` : "—"}
                    </span>
                  </div>
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
