// src/components/TodoList.jsx
import { useState } from "react";
import { doc, deleteDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { format } from "date-fns";
import "./TodoList.css";

const priorityLabel = (value) =>
  value === 1 ? "低" : value === 3 ? "高" : "中";

const uncertaintyLabel = (value) => {
  switch (value) {
    case 1: return "小";
    case 2: return "中";
    case 3: return "大";
    case 4: return "特大";
    case 5: return "超特大";
    default: return "未設定";
  }
};

const toTime = (v) => v?.toDate?.()?.getTime?.() ?? null;

// 表示用の概算T_req（UIだけの目安）
// ※ 実際の通知計算は scheduleShift.js 側（修正版PERT）で実施
const PRIORITY_FACTOR = { 1: 0.85, 2: 1.0, 3: 1.30 };
const DEFAULT_BUFFER_RATE = 0.30;
const calcTreqMinutes = (todo) => {
  const E = Number(todo?.estimatedMinutes) || 60;
  const B = DEFAULT_BUFFER_RATE;
  const P = PRIORITY_FACTOR[todo?.priority] ?? 1.0;
  return Math.round(E * (1 + B) * P);
};

// 並び順
const SORT_OPTIONS = [
  { key: "createdAt", label: "登録順" },
  { key: "startRecommend", label: "通知順" },
  { key: "deadline", label: "締切順" },
];

/** 調整情報（startRaw→startRecommend）を整形して返す
 *  diffMin > 0: 前倒し / diffMin < 0: 繰り下げ
 *  理由は scheduleShift.js が書き込む explain.* を参照
 */
const getAdjustInfo = (t) => {
  const sr = t.startRecommend?.toDate?.();
  const raw = t.startRaw?.toDate?.();
  if (!sr || !raw) return null;

  const diffMin = Math.round((raw.getTime() - sr.getTime()) / 60000);
  if (diffMin === 0) return null;

  const ex = t.explain || {};
  const reasons = [];

  // 時間帯（通知ウィンドウ×作業可能時間）への丸め
  if (ex.decidedStartIso && ex.latestStartIso_effective) {
    reasons.push("時間帯の許可範囲に合わせて調整");
  }
  // 日次キャパ＆衝突ガードでの前倒し（latestAllowed に吸着していれば）
  if (ex.nonOverlapGuard?.latestAllowedIso && ex.decidedStartIso) {
    const la = new Date(ex.nonOverlapGuard.latestAllowedIso).getTime();
    const ds = new Date(ex.decidedStartIso).getTime();
    if (la === ds) reasons.push("日次キャパ・衝突回避のため前倒し");
  }

  const direction = diffMin > 0 ? `（${diffMin}分 前倒し）` : `（${Math.abs(diffMin)}分 繰り下げ）`;
  return { sr, raw, diffMin, direction, reasonText: reasons.join(" / ") };
};

function TodoList({ todos, userId }) {
  const [sortBy, setSortBy] = useState("createdAt");
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(false);
  const [monthFilter, setMonthFilter] = useState("all");
  const [uncertaintyFilter, setUncertaintyFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");

  /* ==== 月選択肢（タスクがある月のみ） ==== */
  const monthOptions = [...new Set(
    (todos ?? [])
      .map((t) => t.deadline?.toDate?.())
      .filter(Boolean)
      .map((d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)
  )].sort();

  /* ==== フィルタ適用 ==== */
  const filteredTodos = (todos ?? []).filter((t) => {
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

  /* ==== 並び替え ==== */
  const sortedTodos = [...filteredTodos].sort((a, b) => {
    if (sortBy === "startRecommend") {
      return (toTime(a.startRecommend) ?? Infinity) - (toTime(b.startRecommend) ?? Infinity);
    } else if (sortBy === "deadline") {
      return (toTime(a.deadline) ?? Infinity) - (toTime(b.deadline) ?? Infinity);
    } else {
      return 0; // createdAt はそのまま（サーバ側 orderBy 済み） 
    }
  });

  return (
    <div>
      {/* ===== 操作エリア（セグメント＋フィルタ＋トグル） ===== */}
      <div className="list-controls">
        {/* 並び順 */}
        <div className="segmented" role="tablist" aria-label="並び順">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              role="tab"
              aria-selected={sortBy === opt.key}
              className={`seg-btn ${sortBy === opt.key ? "is-active" : ""}`}
              onClick={() => setSortBy(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* 未完のみ */}
        <label className="switch">
          <input
            type="checkbox"
            checked={showIncompleteOnly}
            onChange={() => setShowIncompleteOnly((p) => !p)}
            aria-label="未完のタスクだけ表示"
          />
          <span className="switch-track" aria-hidden="true"></span>
          <span className="switch-label">未完のみ</span>
        </label>

        {/* 月フィルタ（タスクのある月のみ） */}
        <select
          className="filter-select"
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          aria-label="月で絞り込み"
        >
          <option value="all">すべての月</option>
          {monthOptions.map((ym) => (
            <option key={ym} value={ym}>
              {ym.split("-")[0]}年{Number(ym.split("-")[1])}月
            </option>
          ))}
        </select>

        {/* 不確実性フィルタ（旧・規模） */}
        <select
          className="filter-select"
          value={uncertaintyFilter}
          onChange={(e) => setUncertaintyFilter(e.target.value)}
          aria-label="不確実性で絞り込み"
        >
          <option value="all">不確実性: 全て</option>
          <option value={1}>小</option>
          <option value={2}>中</option>
          <option value={3}>大</option>
          <option value={4}>特大</option>
          <option value={5}>超特大</option>
        </select>

        {/* 優先度フィルタ */}
        <select
          className="filter-select"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          aria-label="優先度で絞り込み"
        >
          <option value="all">優先度: 全て</option>
          <option value={3}>高</option>
          <option value={2}>中</option>
          <option value={1}>低</option>
        </select>
      </div>

      {/* ===== リスト ===== */}
      <ul className="list">
        {sortedTodos.map((todo) => {
          const notifyAt = todo.startRecommend?.toDate && todo.startRecommend.toDate();
          const deadlineAt = todo.deadline?.toDate && todo.deadline.toDate();
          const adj = getAdjustInfo(todo);

          const TreqMin = calcTreqMinutes(todo);
          const TreqH = (TreqMin / 60).toFixed(TreqMin % 60 === 0 ? 0 : 1);
          const E = Number(todo?.estimatedMinutes) || null;

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
                  {adj && (
                    <span
                      className="badge badge-adjust"
                      title={`通知を調整 ${adj.direction}${adj.reasonText ? "｜理由: " + adj.reasonText : ""}`}
                    >
                      調整済
                    </span>
                  )}
                </label>

                <div className="meta-block">
                  <div className="meta muted">
                    {deadlineAt && <>締切:&nbsp;{format(deadlineAt, "yyyy/M/d HH:mm")}</>}
                    {notifyAt && <div className="note">通知:&nbsp;{format(notifyAt, "M/d HH:mm")}</div>}
                    {adj && (
                      <div className="meta">
                        調整:&nbsp;
                        {format(adj.raw, "M/d HH:mm")} → {format(adj.sr, "M/d HH:mm")} {adj.direction}
                      </div>
                    )}
                  </div>

                  <div className="meta">
                    {E && <div>E（所要）: {E} 分</div>}
                    <div>想定所要（目安）: 約 {TreqMin} 分（≒ {TreqH} 時間）</div>
                    <div>
                      優先度:
                      <span className={`badge badge-priority-${todo.priority}`}>
                        {priorityLabel(todo.priority)}
                      </span>
                      不確実性:
                      <span className={`badge badge-scale-${todo.scale}`}>
                        {uncertaintyLabel(todo.scale)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <button
                className="icon-btn delete-btn"
                onClick={() => deleteDoc(doc(db, "todos", todo.id))}
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
