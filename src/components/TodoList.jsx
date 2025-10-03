// src/components/TodoList.jsx
import { useState } from "react";
import { doc, deleteDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { useAuth } from "../hooks/useAuth";
import { format } from "date-fns";
import "./TodoList.css";

const toTime = (v) => v?.toDate?.()?.getTime?.() ?? null;

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

  const handleChange = (id, v) => {
    setInputs((m) => ({ ...m, [id]: v }));
  };

  const addActual = async (todo) => {
    if (!user) return;
    const raw = inputs[todo.id];
    const addMin = Math.round(Number(raw));
    if (!Number.isFinite(addMin) || addMin <= 0) return;

    const current = Number.isFinite(Number(todo.actualTotalMinutes))
      ? Number(todo.actualTotalMinutes)
      : 0;

    try {
      await updateDoc(doc(db, "todos", todo.id), {
        actualTotalMinutes: current + addMin,
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

  // 締切順（未設定は最後）
  const sorted = [...todos].sort((a, b) => {
    const da = toTime(a.deadline) ?? Infinity;
    const db_ = toTime(b.deadline) ?? Infinity;
    return da - db_;
  });

  return (
    <div>
      <ul className="list">
        {sorted.map((todo) => {
          const deadlineAt = todo.deadline?.toDate?.();
          const E = Number.isFinite(Number(todo.estimatedMinutes))
            ? Number(todo.estimatedMinutes)
            : null;
          const actual = Number.isFinite(Number(todo.actualTotalMinutes))
            ? Math.max(0, Math.round(Number(todo.actualTotalMinutes)))
            : 0;
          const progress = E ? actual / E : null;
          const remaining = E ? Math.max(0, E - actual) : null;

          // 必要ペース（分/日）
          let requiredPerDay = null;
          if (deadlineAt && remaining != null) {
            const now = new Date();
            const msLeft = deadlineAt.getTime() - now.getTime();
            const daysLeft = Math.max(1, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
            requiredPerDay = remaining / daysLeft;
          }

          return (
            <li key={todo.id} className="todo-item">
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
                    <span className="meta-value">{E != null ? `${E} 分` : "—"}</span>
                  </div>

                  {/* 2行目：実績合計・進捗率・残り */}
                  <div className="meta-line">
                    <span className="meta-label">実績:</span>
                    <span className="meta-value">{`${actual} 分`}</span>

                    <span className="spacer" />
                    <span className="meta-label">進捗率:</span>
                    <span className="meta-value">
                      {progress != null ? percent(progress) : "—"}
                    </span>

                    <span className="spacer" />
                    <span className="meta-label">残り:</span>
                    <span className="meta-value">
                      {remaining != null ? `${remaining} 分` : "—"}
                    </span>
                  </div>

                  {/* 3行目：必要ペース */}
                  <div className="meta-line">
                    <span className="meta-label">必要ペース:</span>
                    <span className="meta-value">
                      {requiredPerDay != null
                        ? `${Math.ceil(requiredPerDay)} 分/日`
                        : "—"}
                    </span>
                  </div>

                  {/* 4行目：実績追加フォーム */}
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
      {sorted.length === 0 && (
        <p style={{ padding: 12, color: "#666" }}>タスクはまだありません。</p>
      )}
    </div>
  );
}
