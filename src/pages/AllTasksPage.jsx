import React, { useMemo, useState, useEffect } from "react";
import TodoList from "../components/TodoList";

export default function AllTasksPage({
  todos,
  notificationMode = "justInTime",
  onToggleDailyProgress,
}) {
  // 未完了のみフィルター（ローカル保存）
  const [incompleteOnly, setIncompleteOnly] = useState(() => {
    return localStorage.getItem("tasks_filter_incomplete") === "1";
  });
  useEffect(() => {
    localStorage.setItem("tasks_filter_incomplete", incompleteOnly ? "1" : "0");
  }, [incompleteOnly]);

  // 表示用にフィルタリングしてから TodoList へ渡す
  const displayed = useMemo(() => {
    const list = Array.isArray(todos) ? todos : [];
    return incompleteOnly ? list.filter((t) => !t?.completed) : list;
  }, [todos, incompleteOnly]);

  const total = Array.isArray(todos) ? todos.length : 0;
  const remaining = Array.isArray(todos)
    ? todos.filter((t) => !t?.completed).length
    : 0;

  return (
    <main className="app-main">
      <div className="container">
        <section className="card" style={{ padding: "16px 16px 8px" }}>
          {/* ===== 上部ヘッダー（常に固定） ===== */}
          <header
            style={{
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 12,
              position: "sticky",
              top: 0,
              zIndex: 10,
              background: "#fff",
              paddingBottom: 8,
              borderBottom: "1px solid #eee",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 20, lineHeight: 1.3 }}>
                すべてのタスク
              </h2>
              <p style={{ margin: "6px 0 0", color: "#666", fontSize: 13 }}>
                期限やラベルに関係なく、登録済みのタスクをまとめて確認できます。
                追加はホーム（カレンダー画面）の「＋」から行ってください。
              </p>
            </div>

            {/* ← 未完了のみトグル */}
            <label
              title="完了していないタスクだけを表示"
              style={{
                userSelect: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 14,
                border: "1px solid #e5e7eb",
                padding: "6px 10px",
                borderRadius: 10,
                background: "#fff",
                whiteSpace: "nowrap",
              }}
            >
              <input
                type="checkbox"
                checked={incompleteOnly}
                onChange={(e) => setIncompleteOnly(e.target.checked)}
              />
              未完了のみ（{remaining}/{total}）
            </label>
          </header>

          {/* ===== スクロール対象を TodoList 側に移動 ===== */}
          <TodoList
            todos={displayed}
            mode="all"
            notificationMode={notificationMode}
            onToggleDailyProgress={onToggleDailyProgress}
          />
        </section>
      </div>
    </main>
  );
}
