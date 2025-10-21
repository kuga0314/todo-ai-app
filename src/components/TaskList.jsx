// src/components/TodoList.jsx
import { useEffect, useState } from "react";
import {
  doc,
  deleteDoc,
  updateDoc,
  increment,
  addDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { useAuth } from "../hooks/useAuth";
import { format } from "date-fns";
import "./TodoList.css";

const toTime = (v) => v?.toDate?.()?.getTime?.() ?? null;

// JSTの YYYY-MM-DD キー
const jstDateKey = () => {
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return f.format(new Date());
};

function percent(n) {
  if (!Number.isFinite(n)) return "—";
  const p = Math.max(0, Math.min(1, n)) * 100;
  return `${p.toFixed(0)}%`;
}

export default function TodoList({
  todos = [],
  notificationMode = "justInTime", // 互換のため残す（未使用）
}) {
  const { user } = useAuth();
  const [inputs, setInputs] = useState({}); // { [todoId]: "15" }

  // ▼ 未完了フィルター：ローカル保存して復元
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(() => {
    const stored = localStorage.getItem("showIncompleteOnly");
    return stored === null ? true : stored === "true";
  });
  useEffect(() => {
    localStorage.setItem("showIncompleteOnly", String(showIncompleteOnly));
  }, [showIncompleteOnly]);

  const [sortOrder, setSortOrder] = useState("deadlineAsc");
  const [remainingMin, setRemainingMin] = useState("");
  const [remainingMax, setRemainingMax] = useState("");
  const [progressMin, setProgressMin] = useState("");
  const [progressMax, setProgressMax] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [riskModeFilter, setRiskModeFilter] = useState("all");
  void notificationMode; // keep prop for backward compatibility

  const handleChange = (id, v) => {
    setInputs((m) => ({ ...m, [id]: v }));
  };

  // 合計＆当日日別ログを同時に加算（pace7dに効く）
  const addActual = async (todo) => {
    if (!user) return;
    const raw = inputs[todo.id];
    const addMin = Math.round(Number(raw));
    if (!Number.isFinite(addMin) || addMin <= 0) return;

    const todayKey = jstDateKey();

    try {
      await updateDoc(doc(db, "todos", todo.id), {
        actualTotalMinutes: increment(addMin),              // 合計
        [`actualLogs.${todayKey}`]: increment(addMin),      // 当日ログ
      });
      await addDoc(collection(db, "todos", todo.id, "sessions"), {
        date: todayKey,
        minutes: addMin,
        source: "manual",
        trigger: "list",
        createdAt: serverTimestamp(),
      });
      setInputs((m) => ({ ...m, [todo.id]: "" }));
    } catch (e) {
      console.error("add actual minutes failed", e);
      alert("実績の保存に失敗しました。通信環境を確認してください。");
    }
  };

  const toggleComplete = async (todo) => {
    try {
      await updateDoc(doc(db, "todos", todo.id), {
        completed: !todo.completed,
      });
    } catch (e) {
      console.error("toggle complete failed", e);
    }
  };

  const now = new Date();

  const decoratedTodos = todos.map((todo) => {
    const deadlineAt = todo.deadline?.toDate?.();
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

    let requiredPerDay = null;
    if (deadlineAt && remainingMinutes != null) {
      const msLeft = deadlineAt.getTime() - now.getTime();
      const daysLeft = Math.max(1, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
      requiredPerDay = remainingMinutes / daysLeft;
    }

    const spiNum = Number(todo.spi);
    const spiText = Number.isFinite(spiNum) ? spiNum.toFixed(2) : "—";
    const eacText = todo.eacDate ?? "—";
    const riskLevel = todo.riskLevel ?? null;
    const riskMode = todo.riskMode ?? null;

    return {
      todo,
      deadlineAt,
      estimatedMinutes,
      actualMinutes,
      progressRatio,
      remainingMinutes,
      requiredPerDay,
      spiText,
      eacText,
      riskLevel,
      riskMode,
    };
  });

  const filteredTodos = decoratedTodos.filter((item) => {
    if (showIncompleteOnly && item.todo.completed) return false;

    if (remainingMin !== "") {
      const min = Number(remainingMin);
      if (Number.isFinite(min)) {
        if (item.remainingMinutes == null || item.remainingMinutes < min) {
          return false;
        }
      }
    }

    if (remainingMax !== "") {
      const max = Number(remainingMax);
      if (Number.isFinite(max)) {
        if (item.remainingMinutes == null || item.remainingMinutes > max) {
          return false;
        }
      }
    }

    if (progressMin !== "") {
      const minPct = Number(progressMin);
      if (Number.isFinite(minPct)) {
        const threshold = minPct / 100;
        if (item.progressRatio == null || item.progressRatio < threshold) {
          return false;
        }
      }
    }

    if (progressMax !== "") {
      const maxPct = Number(progressMax);
      if (Number.isFinite(maxPct)) {
        const threshold = maxPct / 100;
        if (item.progressRatio == null || item.progressRatio > threshold) {
          return false;
        }
      }
    }

    if (riskFilter === "none") {
      if (item.riskLevel != null && item.riskLevel !== "") {
        return false;
      }
    } else if (riskFilter !== "all") {
      if (item.riskLevel !== riskFilter) {
        return false;
      }
    }

    if (riskModeFilter !== "all") {
      const mode = item.riskMode ?? "none";
      if (riskModeFilter === "none") {
        if (mode !== "none" && mode !== "") {
          return false;
        }
      } else if (mode !== riskModeFilter) {
        return false;
      }
    }

    return true;
  });

  const sortedTodos = [...filteredTodos].sort((a, b) => {
    const aDeadline = toTime(a.todo.deadline);
    const bDeadline = toTime(b.todo.deadline);
    const aProgress = Number.isFinite(a.progressRatio) ? a.progressRatio : null;
    const bProgress = Number.isFinite(b.progressRatio) ? b.progressRatio : null;
    const aRemaining = Number.isFinite(a.remainingMinutes) ? a.remainingMinutes : null;
    const bRemaining = Number.isFinite(b.remainingMinutes) ? b.remainingMinutes : null;
    const aRequired = Number.isFinite(a.requiredPerDay) ? a.requiredPerDay : null;
    const bRequired = Number.isFinite(b.requiredPerDay) ? b.requiredPerDay : null;

    if (sortOrder === "deadlineDesc") {
      if (aDeadline == null && bDeadline == null) return 0;
      if (aDeadline == null) return 1;
      if (bDeadline == null) return -1;
      return bDeadline - aDeadline;
    }

    if (sortOrder === "progressAsc" || sortOrder === "progressDesc") {
      const direction = sortOrder === "progressAsc" ? 1 : -1;
      if (aProgress == null && bProgress == null) return 0;
      if (aProgress == null) return 1;
      if (bProgress == null) return -1;
      return direction * (aProgress - bProgress);
    }

    if (sortOrder === "remainingAsc" || sortOrder === "remainingDesc") {
      const direction = sortOrder === "remainingAsc" ? 1 : -1;
      if (aRemaining == null && bRemaining == null) return 0;
      if (aRemaining == null) return 1;
      if (bRemaining == null) return -1;
      return direction * (aRemaining - bRemaining);
    }

    if (sortOrder === "requiredPerDayAsc" || sortOrder === "requiredPerDayDesc") {
      const direction = sortOrder === "requiredPerDayAsc" ? 1 : -1;
      if (aRequired == null && bRequired == null) return 0;
      if (aRequired == null) return 1;
      if (bRequired == null) return -1;
      return direction * (aRequired - bRequired);
    }

    // default: 締切が近い順
    if (aDeadline == null && bDeadline == null) return 0;
    if (aDeadline == null) return 1;
    if (bDeadline == null) return -1;
    return aDeadline - bDeadline;
  });

  const resetFilters = () => {
    setShowIncompleteOnly(true);
    setSortOrder("deadlineAsc");
    setRemainingMin("");
    setRemainingMax("");
    setProgressMin("");
    setProgressMax("");
    setRiskFilter("all");
    setRiskModeFilter("all");
  };

  const total = Array.isArray(todos) ? todos.length : 0;
  const remaining = Array.isArray(todos)
    ? todos.filter((t) => !t?.completed).length
    : 0;

  return (
    <div>
      <div className="list-controls">
        <label className="switch" htmlFor="toggleIncomplete" title="完了していないタスクだけを表示">
          <input
            id="toggleIncomplete"
            type="checkbox"
            checked={showIncompleteOnly}
            onChange={(e) => setShowIncompleteOnly(e.target.checked)}
          />
          <span className="switch-track" />
          <span className="switch-label">未完了のみ（{remaining}/{total}）</span>
        </label>

        <div className="filter-row">
          <div className="filter-group">
            <label htmlFor="sortOrder">並び替え</label>
            <select
              id="sortOrder"
              className="filter-select"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            >
              <option value="deadlineAsc">締切が近い順</option>
              <option value="deadlineDesc">締切が遠い順</option>
              <option value="progressDesc">進捗率が高い順</option>
              <option value="progressAsc">進捗率が低い順</option>
              <option value="remainingAsc">残り時間が少ない順</option>
              <option value="remainingDesc">残り時間が多い順</option>
              <option value="requiredPerDayDesc">必要ペースが高い順</option>
              <option value="requiredPerDayAsc">必要ペースが低い順</option>
            </select>
          </div>

          <div className="filter-group">
            <label>残り時間 (分)</label>
            <div className="range-inputs">
              <input
                type="number"
                min="0"
                className="filter-input"
                placeholder="最小"
                value={remainingMin}
                onChange={(e) => setRemainingMin(e.target.value)}
              />
              <span className="range-separator">〜</span>
              <input
                type="number"
                min="0"
                className="filter-input"
                placeholder="最大"
                value={remainingMax}
                onChange={(e) => setRemainingMax(e.target.value)}
              />
            </div>
          </div>

          <div className="filter-group">
            <label>進捗率 (%)</label>
            <div className="range-inputs">
              <input
                type="number"
                min="0"
                max="100"
                className="filter-input"
                placeholder="最小"
                value={progressMin}
                onChange={(e) => setProgressMin(e.target.value)}
              />
              <span className="range-separator">〜</span>
              <input
                type="number"
                min="0"
                max="300"
                className="filter-input"
                placeholder="最大"
                value={progressMax}
                onChange={(e) => setProgressMax(e.target.value)}
              />
            </div>
          </div>

          <div className="filter-group">
            <label htmlFor="riskFilter">リスク</label>
            <select
              id="riskFilter"
              className="filter-select filter-select--label"
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
            >
              <option value="all">すべて</option>
              <option value="ok">🟢 良好</option>
              <option value="warn">🟡 注意</option>
              <option value="late">🔴 遅延</option>
              <option value="none">未判定</option>
            </select>
          </div>

          <div className="filter-group">
            <label htmlFor="riskModeFilter">リスクモード</label>
            <select
              id="riskModeFilter"
              className="filter-select"
              value={riskModeFilter}
              onChange={(e) => setRiskModeFilter(e.target.value)}
            >
              <option value="all">すべて</option>
              <option value="safe">安全運転</option>
              <option value="mean">標準</option>
              <option value="challenge">チャレンジ</option>
              <option value="none">未設定</option>
            </select>
          </div>

          <button className="btn-mini filter-reset" onClick={resetFilters}>
            条件クリア
          </button>
        </div>
      </div>

      <ul className="list">
        {sortedTodos.map((item) => {
          const {
            todo,
            deadlineAt,
            estimatedMinutes,
            actualMinutes,
            progressRatio,
            remainingMinutes,
            requiredPerDay,
            spiText,
            eacText,
            riskLevel,
          } = item;
          const risk = riskLevel; // "ok" | "warn" | "late" | undefined

          const borderColor =
            risk === "late" ? "#ef4444" : // 赤
            risk === "warn" ? "#f59e0b" : // 黄
            risk === "ok"   ? "#10b981" : // 緑
            "#cbd5e1";                    // グレー

          return (
            <li
              key={todo.id}
              className="todo-item"
              style={{
                borderLeft: "6px solid",
                borderLeftColor: borderColor,
              }}
            >
              {/* タイトル & 完了チェック */}
              <div className="todo-content">
                <label className="todo-main">
                  <input
                    type="checkbox"
                    checked={!!todo.completed}
                    onChange={() => toggleComplete(todo)}
                  />
                  <span className={`todo-title ${todo.completed ? "is-done" : ""}`}>
                    {todo.text}
                  </span>
                </label>

                {/* メタ情報 */}
                <div className="meta-lines">
                  {/* 1行目：締切・E */}
                  <div className="meta-line">
                    <span className="meta-label">締切:</span>
                    <span className="meta-value">
                      {deadlineAt ? format(deadlineAt, "yyyy/M/d HH:mm") : "—"}
                    </span>
                    <span className="spacer" />
                    <span className="meta-label">E:</span>
                    <span className="meta-value">
                      {estimatedMinutes != null ? `${estimatedMinutes} 分` : "—"}
                    </span>
                  </div>

                  {/* 2行目：実績合計・進捗率・残り */}
                  <div className="meta-line">
                    <span className="meta-label">実績:</span>
                    <span className="meta-value">{`${actualMinutes} 分`}</span>

                    <span className="spacer" />
                    <span className="meta-label">進捗率:</span>
                    <span className="meta-value">
                      {progressRatio != null ? percent(progressRatio) : "—"}
                    </span>

                    <span className="spacer" />
                    <span className="meta-label">残り:</span>
                    <span className="meta-value">
                      {remainingMinutes != null ? `${remainingMinutes} 分` : "—"}
                    </span>
                  </div>

                  {/* 3行目：必要ペース */}
                  <div className="meta-line">
                    <span className="meta-label">必要ペース:</span>
                    <span className="meta-value">
                      {requiredPerDay != null ? `${Math.ceil(requiredPerDay)} 分/日` : "—"}
                    </span>
                  </div>

                  {/* 4行目：SPI / EAC / リスク */}
                  <div className="meta-line">
                    <span className="meta-label">SPI:</span>
                    <span className="meta-value">{spiText}</span>

                    <span className="spacer" />
                    <span className="meta-label">EAC:</span>
                    <span className="meta-value">{eacText}</span>

                    <span className="spacer" />
                    <span className="meta-label">リスク:</span>
                    <span
                      className="meta-value"
                      title={risk ?? ""}
                      style={{ fontWeight: 600 }}
                    >
                      {risk === "late" ? "🔴 遅延"
                        : risk === "warn" ? "🟡 注意"
                        : risk === "ok"   ? "🟢 良好"
                        : "—"}
                    </span>
                  </div>

                  {/* 5行目：実績追加フォーム */}
                  <div className="meta-line">
                    <label className="meta-label" htmlFor={`act-${todo.id}`}>
                      実績追加:
                    </label>
                    <input
                      id={`act-${todo.id}`}
                      type="number"
                      min={1}
                      step={1}
                      placeholder="例: 30"
                      className="ti-number"
                      style={{ width: 96, marginLeft: 6, marginRight: 8 }}
                      value={inputs[todo.id] ?? ""}
                      onChange={(e) => handleChange(todo.id, e.target.value)}
                    />
                    <button
                      className="btn-mini"
                      onClick={() => addActual(todo)}
                      disabled={!inputs[todo.id]}
                      title="実績(分)を加算"
                    >
                      追加
                    </button>
                  </div>
                </div>
              </div>

              {/* 削除 */}
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

      {/* 何もない時の簡易メッセージ */}
      {sortedTodos.length === 0 && (
        <p style={{ padding: 12, color: "#666" }}>
          タスクはまだありません。
        </p>
      )}
    </div>
  );
}
