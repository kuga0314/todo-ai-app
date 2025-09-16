// src/components/TodoList.jsx
import { useState } from "react";
import { doc, deleteDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { format } from "date-fns";
import "./TodoList.css";

const priorityLabel = (v) => (v === 1 ? "低" : v === 3 ? "高" : "中");
const uncertaintyLabel = (v) =>
  ({ 1: "小", 2: "中", 3: "大", 4: "特大", 5: "超特大" }[v] || "未設定");

const toTime = (v) => v?.toDate?.()?.getTime?.() ?? null;

// 三点見積もり期待値（表示専用）
const calcTE = (todo) => {
  const w = Number.isFinite(+todo?.pertWeight) ? +todo.pertWeight : 4;
  const M = Number.isFinite(+todo?.estimatedMinutes) ? +todo.estimatedMinutes : null;
  if (!M) return null;
  const O = 0.8 * M;
  const P = 1.5 * M;
  return (O + w * M + P) / (w + 2); // 例: M=90 → TE≈94.5
};

// 並び順
const SORT_OPTIONS = [
  { key: "createdAt", label: "登録順" },
  { key: "startRecommend", label: "通知順" },
  { key: "deadline", label: "締切順" },
];

function TodoList({ todos, userId }) {
  const [sortBy, setSortBy] = useState("createdAt");
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(false);
  const [monthFilter, setMonthFilter] = useState("all");
  const [uncertaintyFilter, setUncertaintyFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");

  // 月フィルタ候補（タスクがある月のみ）
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

    return true;
  });

  // 並べ替え
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "startRecommend")
      return (toTime(a.startRecommend) ?? Infinity) - (toTime(b.startRecommend) ?? Infinity);
    if (sortBy === "deadline")
      return (toTime(a.deadline) ?? Infinity) - (toTime(b.deadline) ?? Infinity);
    return 0; // createdAtはサーバ側orderBy依存
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
          <span className="switch-track"></span>
          <span className="switch-label">未完のみ</span>
        </label>

        <div className="filter-row">
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
        </div>
      </div>

      {/* リスト */}
      <ul className="list">
        {sorted.map((todo) => {
          const deadlineAt     = todo.deadline?.toDate?.();
          const notifyAt       = todo.startRecommend?.toDate?.();
          const latestStartAt  = todo.latestStart?.toDate?.();   // ★ 後方計画L
          const E  = Number(todo?.estimatedMinutes) || null;
          const TE = calcTE(todo);
          const TEh = TE ? (TE / 60).toFixed(1) : null;

          return (
            <li key={todo.id} className="todo-item">
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
                </label>

                {/* === 3行レイアウト === */}
                <div className="meta-lines">
                  {/* 1行目：締切・通知・L */}
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
                    <span className="spacer" />
                    <span className="meta-label">L:</span>
                    <span className="meta-value">
                      {latestStartAt ? format(latestStartAt, "M/d HH:mm") : "—"}
                    </span>
                  </div>

                  {/* 2行目：規模（不確実性）と優先度 */}
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
                  </div>

                  {/* 3行目：E と TE */}
                  <div className="meta-line">
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
