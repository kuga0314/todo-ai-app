// src/components/DailyPlan.jsx
import { useMemo } from "react";
import { format } from "date-fns";

/**
 * 日次プラン一覧（最小構成）
 * - props:
 *   - plans: [{ id, date: 'YYYY-MM-DD', items: [{ todoId, minutes }] }]
 *   - todos: [{ id, text, estimatedMinutes, actualTotalMinutes, deadline, dailyProgress? }]
 *   - onToggleDailyProgress: (todoId: string, dateKey: string, checked: boolean) => void
 *   - headline?: string
 *   - showUpcoming?: boolean  // true: すべての日付, false: 今日のみ
 *
 * - 表示:
 *   日付ごとに、その日に割り当てられたタスク一覧を表示。
 *   各行にチェックボックス（完了フラグ）と分数（minutes）を表示。
 *   priority / w / O / P 等は一切表示しない。
 */

function ymd(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function DailyPlan({
  plans = [],
  todos = [],
  onToggleDailyProgress,
  headline = "今日のプラン",
  showUpcoming = false,
}) {
  const todayKey = ymd(new Date());

  const todosMap = useMemo(() => {
    const m = new Map();
    for (const t of todos) m.set(t.id, t);
    return m;
  }, [todos]);

  // 表示対象のプランを抽出
  const visiblePlans = useMemo(() => {
    const rows = (plans || []).filter((p) => p && typeof p.date === "string");
    if (!showUpcoming) {
      return rows.filter((p) => p.date === todayKey);
    }
    return rows;
  }, [plans, showUpcoming, todayKey]);

  const titleText = showUpcoming ? (headline || "日次プラン一覧") : (headline || "今日のプラン");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ margin: 0, fontSize: "1.05rem" }}>{titleText}</h3>

      {visiblePlans.length === 0 && (
        <p style={{ margin: 0, color: "#666" }}>
          {showUpcoming ? "予定された日次プランはありません。" : "今日は予定された日次プランがありません。"}
        </p>
      )}

      {visiblePlans.map((plan) => {
        const dateObj = safeDateFromKey(plan.date);
        const title = dateObj ? format(dateObj, "yyyy/M/d (EEE)") : plan.date;
        const items = Array.isArray(plan.items) ? plan.items : [];

        return (
          <section
            key={plan.id || plan.date}
            style={{
              background: "#fff",
              borderRadius: 12,
              border: "1px solid #eee",
              padding: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ fontWeight: 700 }}>{title}</div>
              <div style={{ fontSize: ".85rem", color: "#666" }}>
                {items.length} 件
              </div>
            </div>

            {items.length === 0 ? (
              <div style={{ color: "#777", fontSize: ".9rem" }}>この日の割り当てはありません。</div>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                {items.map((it, idx) => {
                  const todo = it?.todoId ? todosMap.get(it.todoId) : null;
                  const minutes = Number.isFinite(Number(it?.minutes)) ? Math.max(0, Math.round(Number(it.minutes))) : null;

                  const checked = !!(todo?.dailyProgress && todo.dailyProgress[plan.date]);
                  const toggle = () => {
                    if (typeof onToggleDailyProgress === "function" && todo?.id) {
                      onToggleDailyProgress(todo.id, plan.date, !checked);
                    }
                  };

                  return (
                    <li
                      key={`${plan.id || plan.date}-${it?.todoId || idx}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "24px 1fr max-content",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 10px",
                        border: "1px solid #eee",
                        borderRadius: 10,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={toggle}
                        title={checked ? "今日の割り当てを未完にする" : "今日の割り当てを完了にする"}
                      />

                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {todo?.text ?? "(削除済み or 不明なタスク)"}
                        </div>

                        {/* 進捗の簡易メタ：E / 実績合計 / 残り */}
                        {todo && (
                          <div style={{ display: "flex", gap: 12, color: "#666", fontSize: ".85rem", marginTop: 2 }}>
                            <span>E: {numOrDash(todo.estimatedMinutes)}分</span>
                            <span>実績: {numOrDash(todo.actualTotalMinutes)}分</span>
                            <span>残り: {remOrDash(todo.estimatedMinutes, todo.actualTotalMinutes)}分</span>
                          </div>
                        )}
                      </div>

                      <div style={{ fontVariantNumeric: "tabular-nums", color: "#333" }}>
                        {minutes != null ? `${minutes} 分` : "—"}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function numOrDash(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.round(v)) : "—";
}

function remOrDash(E, A) {
  const e = Number(E);
  const a = Number(A);
  if (!Number.isFinite(e)) return "—";
  const aa = Number.isFinite(a) ? a : 0;
  return Math.max(0, Math.round(e - aa));
}

function safeDateFromKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [y, m, d] = key.split("-").map((s) => parseInt(s, 10));
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  return isNaN(dt.getTime()) ? null : dt;
}
