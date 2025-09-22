// src/components/TodoCalendar.jsx
import React, { useMemo, useState, useEffect } from "react";
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
import { getDeadline } from "../utils/calendarHelpers";

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

export default function TodoCalendar({ todos, onAdd }) {
  const { user } = useAuth();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);

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
    return (todos ?? [])
      .map((t) => {
        const d = getDeadline(t);
        if (!d || Number.isNaN(d.getTime())) return null;

        // ★ todo.labelId に紐づく色をひく（なければ既定色）
        const lb = labels.find((l) => l.id === t.labelId);
        const color = lb?.color ?? "#5c6bc0"; // 既定: 少し落ち着いたブルー

        return {
          id: t.id,
          title: t.text,
          start: d,
          end: d,
          allDay: true,
          completed: !!t.completed,
          labelId: t.labelId ?? null,
          color, // ★ イベント自身にも持たせておく
        };
      })
      .filter(Boolean);
  }, [todos, labels]);

  return (
    <div className="calendar-wrapper" style={{ flex: 1, display: "flex" }}>
      <div className="calendar-box" style={{ flex: 1, position: "relative" }}>
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
          messages={{ month: "月表示", today: "今日", previous: "前", next: "次" }}
          // ★ ラベル色を背景色に反映。完了クラスは維持。
          eventPropGetter={(event) => {
            const baseClass = event.completed
              ? "event-completed"
              : "event-active";
            return {
              className: baseClass,
              style: {
                backgroundColor: event.color,
                color: "#fff", // ★ 黒 → 白文字に変更
                opacity: 0.9,
                border: "none",
                padding: "4px 6px",   // ★ 縦幅拡大
                lineHeight: 1.4,
              },
            };
          }}
          style={{ height: "100%" }}
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
      </div>
    </div>
  );
}
