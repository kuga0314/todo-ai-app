// src/components/DayPanel.jsx
import React, { useMemo, useState } from "react";
import { format, isSameDay, startOfDay, endOfDay } from "date-fns";
import TaskList from "./TaskList";
import { getDeadline, getNotifyAt } from "../utils/calendarHelpers";

/**
 * @param {Object} props
 * @param {Date}   props.selectedDate
 * @param {Array}  props.todos
 * @param {() => void} props.onClose
 */
export default function DayPanel({ selectedDate, todos, onClose }) {
  const [activeTab, setActiveTab] = useState("deadline"); // "deadline" | "working"

  const deadlineTasksForSelected = useMemo(() => {
    if (!selectedDate) return [];
    return (todos ?? []).filter((t) => {
      const d = getDeadline(t);
      return d && isSameDay(d, selectedDate);
    });
  }, [todos, selectedDate]);

  // 通知日〜締切の期間中は毎日表示
  const workingTasksForSelected = useMemo(() => {
    if (!selectedDate) return [];
    const dayStart = startOfDay(selectedDate);
    const dayEnd = endOfDay(selectedDate);

    return (todos ?? []).filter((t) => {
      const start = getNotifyAt(t);
      const end = getDeadline(t);
      if (!start || !end) return false;
      const rangeStart = startOfDay(start);
      const rangeEnd = endOfDay(end);
      return dayStart <= rangeEnd && dayEnd >= rangeStart;
    });
  }, [todos, selectedDate]);

  return (
    <div
      className="day-panel-left card"
      style={{
        position: "absolute",
        left: 12,
        top: 12,
        width: "min(520px, calc(100% - 24px))",
        maxHeight: "calc(100% - 24px)",
        overflow: "auto",
        background: "#fff",
        borderRadius: 14,
        boxShadow: "0 10px 24px rgba(0,0,0,.15)",
        zIndex: 5,
      }}
    >
      <div
        className="modal-head"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <h3 style={{ margin: 0 }}>{format(selectedDate, "yyyy年M月d日")}</h3>
        <div className="tab-controls" role="tablist" aria-label="表示切替">
          <button
            role="tab"
            aria-selected={activeTab === "deadline"}
            className={`tab ${activeTab === "deadline" ? "active" : ""}`}
            onClick={() => setActiveTab("deadline")}
          >
            締切タスク
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "working"}
            className={`tab ${activeTab === "working" ? "active" : ""}`}
            onClick={() => setActiveTab("working")}
          >
            取り組むタスク
          </button>
          <button className="btn btn-close" onClick={onClose} style={{ marginLeft: 8 }}>
            閉じる
          </button>
        </div>
      </div>

      {activeTab === "deadline" ? (
        <TaskList tasks={deadlineTasksForSelected} mode="deadline" />
      ) : (
        <TaskList tasks={workingTasksForSelected} mode="working" />
      )}
    </div>
  );
}
