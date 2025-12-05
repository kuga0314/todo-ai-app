import React, { useEffect, useMemo, useState } from "react";
import TodoList from "../components/TodoList";
import "./AllTasksPage.css";

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
        <section className="card all-tasks__section">
          {/* ===== 上部ヘッダー（常に固定） ===== */}
          <header className="all-tasks__header">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2>すべてのタスク</h2>
              <p className="all-tasks__desc">
                期限やラベルに関係なく、登録済みのタスクをまとめて確認できます。
                追加はホーム（カレンダー画面）の「＋」から行ってください。
              </p>
            </div>
          </header>

          <div className="all-tasks__filters">
            <label className="all-tasks__checkbox">
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
