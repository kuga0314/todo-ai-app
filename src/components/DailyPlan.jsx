import React, { useMemo } from "react";
import { format, parseISO } from "date-fns";
import "./DailyPlan.css";
import {
  todayKey,
  formatMinutes,
  formatDateWithWeekday,
  getImportanceLabel,
} from "../utils/calendarHelpers";

const parseDeadline = (iso) => {
  if (typeof iso !== "string") return null;
  const dt = parseISO(iso);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

function importanceBadge(importance) {
  const label = getImportanceLabel({ priority: importance });
  const color = importance === 3 ? "#dc2626" : importance === 1 ? "#16a34a" : "#f59e0b";
  return { label, color };
}

export default function DailyPlan({
  plans = [],
  todos = [],
  targetDate,
  onToggleDailyProgress,
  headline = "今日の学習プラン",
  showUpcoming = false,
}) {
  const today = todayKey();
  const targetKey = targetDate || today;

  const todosById = useMemo(() => {
    const map = new Map();
    (todos ?? []).forEach((todo) => {
      if (todo?.id) map.set(todo.id, todo);
    });
    return map;
  }, [todos]);

  const sortedPlans = useMemo(
    () => [...(plans ?? [])].sort((a, b) => (a.date || "").localeCompare(b.date || "")),
    [plans]
  );

  const currentPlan = sortedPlans.find((p) => p.date === targetKey) || null;
  const upcomingPlans = showUpcoming
    ? sortedPlans.filter((p) => p.date > targetKey).slice(0, 5)
    : [];

  const handleToggle = async (todoId, dateKey, checked) => {
    if (typeof onToggleDailyProgress !== "function") return;
    try {
      await onToggleDailyProgress(todoId, dateKey, checked);
    } catch (error) {
      console.error("daily plan toggle failed", error);
    }
  };

  return (
    <section className="daily-plan-card">
      <header className="daily-plan-header">
        <div>
          <h3>{headline}</h3>
          <p className="daily-plan-sub">
            {currentPlan
              ? `${formatDateWithWeekday(currentPlan.date)} ／ 合計 ${formatMinutes(
                  currentPlan.totalMinutes
                )}`
              : `${formatDateWithWeekday(targetKey)} ／ 割当はありません`}
          </p>
        </div>
      </header>

      {currentPlan ? (
        <ul className="daily-plan-list">
          {currentPlan.assignments.map((assignment) => {
            const todo = todosById.get(assignment.todoId) || {};
            const done = !!todo?.dailyProgress?.[currentPlan.date];
            const minutesText = formatMinutes(assignment.minutes);
            const { label, color } = importanceBadge(assignment.importance);
            const deadline = parseDeadline(assignment.deadlineIso || todo?.deadlineIso);

            return (
              <li
                key={`${assignment.todoId}-${currentPlan.date}`}
                className={`daily-plan-item ${done ? "is-done" : ""}`}
              >
                <div className="daily-plan-main">
                  <label className="daily-plan-check">
                    <input
                      type="checkbox"
                      checked={done}
                      onChange={(e) =>
                        handleToggle(assignment.todoId, currentPlan.date, e.target.checked)
                      }
                    />
                    <span className="daily-plan-title">
                      {assignment.text || todo?.text || "無題のタスク"}
                    </span>
                  </label>
                  <span
                    className="daily-plan-importance"
                    style={{ backgroundColor: color }}
                  >
                    重要度: {label}
                  </span>
                </div>
                <div className="daily-plan-meta">
                  <span>{minutesText}</span>
                  {deadline && (
                    <span className="daily-plan-deadline">
                      締切 {format(deadline, "M/d HH:mm")}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="daily-plan-empty">
          <p>この日は割り当てられた作業がありません。自由時間を活用しましょう。</p>
        </div>
      )}

      {showUpcoming && upcomingPlans.length > 0 && (
        <section className="daily-plan-upcoming">
          <h4>今後の予定</h4>
          <ul>
            {upcomingPlans.map((plan) => (
              <li key={plan.date}>
                <span className="date">{formatDateWithWeekday(plan.date)}</span>
                <span className="minutes">{formatMinutes(plan.totalMinutes)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
