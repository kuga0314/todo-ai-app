import React from "react";
import TodoList from "../components/TodoList";

/**
 * すべてのタスクを縦スクロールで一覧表示するページ。
 * - App.jsx から props.todos を受け取り、そのまま TodoList に渡します。
 * - レイアウトは既存のクラス（app-main / container / card）を流用。
 * - 追加フォームは置かず、閲覧・編集・完了チェックのみ（追加はホームで）。
 */
export default function AllTasksPage({ todos, notificationMode = "justInTime", onToggleDailyProgress }) {
  return (
    <main className="app-main">
      <div className="container">
        <section className="card" style={{ padding: "16px 16px 8px" }}>
          <header style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 20, lineHeight: 1.3 }}>
              すべてのタスク
            </h2>
            <p style={{ margin: "6px 0 0", color: "#666", fontSize: 13 }}>
              期限やラベルに関係なく、登録済みのタスクをまとめて確認できます。
              追加はホーム（カレンダー画面）の「＋」から行ってください。
            </p>
          </header>

          {/* 
            TodoList 側が Firestore の更新（完了・削除・編集）を内包している想定。
            単純に全件を渡して表示します。
          */}
          <div
            style={{
              // 縦スクロールでたくさんのタスクを快適に表示
              maxHeight: "calc(100vh - 64px - 56px - 24px)",
              overflowY: "auto",
              paddingRight: 4,
            }}
          >
            <TodoList
              todos={todos}
              mode="all"
              notificationMode={notificationMode}
              onToggleDailyProgress={onToggleDailyProgress}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
