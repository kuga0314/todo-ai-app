import React, { useEffect, useMemo, useState } from "react";
import TodoList from "../components/TodoList";

export default function AllTasksPage({
  todos,
  notificationMode = "justInTime",
  onToggleDailyProgress,
}) {
  const [incompleteOnly, setIncompleteOnly] = useState(() => {
    const stored = localStorage.getItem("showIncompleteOnly");
    return stored === null ? true : stored === "true";
  });

  useEffect(() => {
    localStorage.setItem("showIncompleteOnly", String(incompleteOnly));
  }, [incompleteOnly]);

  const { visibleTodos, totalCount, incompleteCount } = useMemo(() => {
    const list = Array.isArray(todos) ? todos : [];
    const incomplete = list.filter((item) => !item?.completed);
    return {
      visibleTodos: incompleteOnly ? incomplete : list,
      totalCount: list.length,
      incompleteCount: incomplete.length,
    };
  }, [todos, incompleteOnly]);

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
          </header>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              margin: "0 0 12px",
            }}
          >
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 14,
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={incompleteOnly}
                onChange={(event) => setIncompleteOnly(event.target.checked)}
              />
              未完タスクのみ表示（{incompleteCount}/{totalCount}）
            </label>
          </div>

          {/* ===== スクロール対象を TodoList 側に移動 ===== */}
          <TodoList
            todos={visibleTodos}
            mode="all"
            notificationMode={notificationMode}
            onToggleDailyProgress={onToggleDailyProgress}
          />
        </section>
      </div>
    </main>
  );
}
