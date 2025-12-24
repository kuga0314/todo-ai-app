// src/components/TodoCalendar.jsx
import React, { useMemo, useState, useEffect, useRef } from "react";
import { Calendar, dateFnsLocalizer, Views } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import {
  format,
  parse,
  startOfWeek as dateFnsStartOfWeek,
  getDay,
} from "date-fns";
import ja from "date-fns/locale/ja";
import "../styles/calendar.css";

import DayPanel from "./DayPanel";
import {
  getDeadline,
  getDailyAssignments,
  formatMinutes,
  dateFromKey,
  endOfDayExclusive,
  isEacOverDeadline,
} from "../utils/calendarHelpers";
import TaskDetailModal from "./TaskDetailModal";

// ★ ラベル購読用
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { useAuth } from "../hooks/useAuth";

const locales = { ja };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (d) => dateFnsStartOfWeek(d, { locale: ja }),
  getDay,
  locales,
});

export default function TodoCalendar({ todos, onAdd, notificationMode = "justInTime" }) {
  const { user } = useAuth();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTodoId, setSelectedTodoId] = useState(null);
  const [shakeIds, setShakeIds] = useState({});
  const shakenRef = useRef(new Set());
  const monthKey = useMemo(() => format(currentDate, "yyyy-MM"), [currentDate]);

  useEffect(() => {
    if (!selectedTodoId) return;
    const exists = (todos ?? []).some((t) => t.id === selectedTodoId);
    if (!exists) setSelectedTodoId(null);
  }, [todos, selectedTodoId]);

  // ★ 設定ページで作成したラベル（name, color）を購読
  const [labels, setLabels] = useState([]);
  useEffect(() => {
    if (!user) return;
    const colRef = collection(db, "users", user.uid, "labels");
    const unsub = onSnapshot(colRef, (snap) => {
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...(d.data() ?? {}) }));
      setLabels(rows);
    });
    return () => unsub();
  }, [user]);

  // カレンダー表示用イベント（締切ベース）
  const events = useMemo(() => {
    const deadlineEvents = (todos ?? [])
      .map((t) => {
        const d = getDeadline(t);
        if (!d || Number.isNaN(d.getTime())) return null;

        const lb = labels.find((l) => l.id === t.labelId);
        const color = lb?.color ?? "#5c6bc0";

        return {
          id: t.id,
          title: t.text,
          start: d,
          end: d,
          allDay: true,
          completed: !!t.completed,
          labelId: t.labelId ?? null,
          color,
          type: "deadline",
          todo: t,
        };
      })
      .filter(Boolean);

    if (notificationMode !== "morningSummary") {
      return deadlineEvents;
    }

    const assignmentEvents = [];

    (todos ?? []).forEach((todo) => {
      const assignments = getDailyAssignments(todo);
      if (!assignments.length) return;
      const lb = labels.find((l) => l.id === todo.labelId);
      const color = lb?.color ?? "#38bdf8";

      assignments.forEach((assignment) => {
        const date = dateFromKey(assignment.date);
        if (!date) return;
        const end = endOfDayExclusive(date) || date;
        assignmentEvents.push({
          id: `${todo.id}-${assignment.date}`,
          title: `[日次] ${todo.text} (${formatMinutes(assignment.minutes)})`,
          start: date,
          end,
          allDay: true,
          completed: !!todo?.dailyProgress?.[assignment.date],
          labelId: todo.labelId ?? null,
          color,
          type: "assignment",
          todoId: todo.id,
          minutes: assignment.minutes,
          dateKey: assignment.date,
          todo,
        });
      });
    });

    return [...deadlineEvents, ...assignmentEvents];
  }, [todos, labels, notificationMode]);

  const warnTodoIds = useMemo(() => {
    const ids = new Set();
    (events ?? []).forEach((event) => {
      const start = event?.start instanceof Date ? event.start : new Date(event?.start);
      if (!start || Number.isNaN(start.getTime())) return;
      if (
        start.getFullYear() !== currentDate.getFullYear() ||
        start.getMonth() !== currentDate.getMonth()
      ) {
        return;
      }
      const todo = event?.todo;
      if (todo && !todo.completed && isEacOverDeadline(todo)) {
        ids.add(todo.id);
      }
    });
    return Array.from(ids);
  }, [events, currentDate]);

  useEffect(() => {
    shakenRef.current = new Set();
    setShakeIds({});
  }, [monthKey]);

  useEffect(() => {
    if (!warnTodoIds.length) return;
    setShakeIds((prev) => {
      const next = { ...prev };
      warnTodoIds.forEach((id) => {
        if (!shakenRef.current.has(id)) {
          shakenRef.current.add(id);
          next[id] = (prev[id] ?? 0) + 1;
        }
      });
      return next;
    });
  }, [warnTodoIds, monthKey]);

  const handleSelectEvent = (event) => {
    const targetId = event.type === "assignment" ? event.todoId : event.id;
    setSelectedTodoId(targetId);
  };

  const handleCloseModal = () => {
    setSelectedTodoId(null);
  };

  const handleBadgeAnimationEnd = (todoId) => {
    if (!todoId) return;
    setShakeIds((prev) => {
      if (!prev[todoId]) return prev;
      const next = { ...prev };
      delete next[todoId];
      return next;
    });
  };

  const CalendarEvent = ({ event }) => {
    const todo = event?.todo;
    const shouldWarn = todo && !todo.completed && isEacOverDeadline(todo);
    const shouldShake = shouldWarn && shakeIds?.[todo.id];
    const warnLabel = "完了予測日が締め切り以降です";

    return (
      <div className="cal-event-content">
        <span className="cal-event-title">{event.title}</span>
        {shouldWarn ? (
          <span
            className={`cal-warn-badge${shouldShake ? " cal-warn-badge--shake" : ""}`}
            title={warnLabel}
            aria-label={warnLabel}
            onAnimationEnd={() => handleBadgeAnimationEnd(todo.id)}
          >
            !
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <div className="calendar-wrapper">
      <div className="calendar-box">
        <Calendar
          localizer={localizer}
          date={currentDate}
          onNavigate={setCurrentDate}
          events={events}
          startAccessor="start"
          endAccessor="end"
          defaultView={Views.MONTH}
          views={{ month: true }}
          culture="ja"
          selectable
          onSelectSlot={(slotInfo) => setSelectedDate(slotInfo.start)}
          onSelectEvent={handleSelectEvent}
          messages={{ month: "月表示", today: "今日", previous: "前", next: "次" }}
          // ★ ラベル色を背景色に反映。完了クラスは維持。
          eventPropGetter={(event) => {
            const isAssignment = event.type === "assignment";
            const baseClass = event.completed
              ? "event-completed"
              : "event-active";
            const style = {
              backgroundColor: event.color,
              color: "#fff",
              opacity: isAssignment ? (event.completed ? 0.45 : 0.8) : 0.9,
              border: isAssignment ? "2px dashed rgba(255,255,255,0.75)" : "none",
              padding: isAssignment ? "4px 6px" : "4px 6px",
              lineHeight: 1.35,
            };
            return {
              className: `${baseClass}${isAssignment ? " event-plan" : ""}`,
              style,
            };
          }}
          components={{ event: CalendarEvent }}
          className="calendar-root"
        />

        {selectedDate && (
          <DayPanel
            selectedDate={selectedDate}
            todos={todos}
            onClose={() => setSelectedDate(null)}
            onAdd={onAdd} // 親の addTodo をそのまま渡す
            labels={labels} // ★ DayPanel にラベルを渡す
          />
        )}

        {selectedTodoId && (
          <TaskDetailModal
            todo={(todos ?? []).find((t) => t.id === selectedTodoId)}
            labels={labels}
            onClose={handleCloseModal}
          />
        )}
      </div>
    </div>
  );
}
