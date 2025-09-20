// src/components/TodoCalendar.jsx
import React, { useMemo, useState } from "react";
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

const locales = { ja };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (d) => dateFnsStartOfWeek(d, { locale: ja }),
  getDay,
  locales,
});

export default function TodoCalendar({ todos }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);

  // カレンダー表示用イベント（締切ベース）
  const events = useMemo(() => {
    return (todos ?? [])
      .map((t) => {
        const d = getDeadline(t);
        if (!d || Number.isNaN(d.getTime())) return null;
        return {
          id: t.id,
          title: t.text,
          start: d,
          end: d,
          allDay: true,
          completed: !!t.completed,
        };
      })
      .filter(Boolean);
  }, [todos]);

  return (
    <div className="calendar-wrapper">
      <div className="calendar-box" style={{ height: 540, position: "relative" }}>
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
          eventPropGetter={(event) => ({
            className: event.completed ? "event-completed" : "event-active",
          })}
          style={{ height: "100%" }}
        />

        {selectedDate && (
          <DayPanel
            selectedDate={selectedDate}
            todos={todos}
            onClose={() => setSelectedDate(null)}
          />
        )}
      </div>
    </div>
  );
}
