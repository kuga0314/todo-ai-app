// src/components/TodoCalendar.jsx
import React, { useState, useMemo } from "react";
import { Calendar, dateFnsLocalizer, Views } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import {
  format,
  parse,
  startOfWeek as dateFnsStartOfWeek,
  getDay,
  isSameDay,
  startOfDay,
  endOfDay,
} from "date-fns";
import ja from "date-fns/locale/ja";
import "../styles/calendar.css";
import { doc, updateDoc, deleteDoc } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";

const locales = { ja };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (d) => dateFnsStartOfWeek(d, { locale: ja }),
  getDay,
  locales,
});

/* ====== ヘルパ ====== */
const toJsDate = (v) =>
  v?.toDate?.() ??
  (typeof v === "string" || typeof v === "number" ? new Date(v) : null);

const getDeadline = (t) =>
  toJsDate(t.deadline ?? t.due ?? t.dueAt ?? t.limitAt ?? null);

const getNotifyAt = (t) =>
  toJsDate(t.startRecommend ?? t.notifyAt ?? t.notificationAt ?? null);

// 「E（所要）」= ユーザー入力の estimatedMinutes を優先して取得
const getEstimatedMinutesE = (t) => {
  const v = t?.estimatedMinutes;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

// 想定所要（UI目安用）：T_req、なければEなど
const getReqMinutes = (t) => {
  const m =
    t.T_req ??
    t.t_req ??
    t.requiredMinutes ??
    t.reqMinutes ??
    t.estimatedMinutes ??
    null;
  if (typeof m === "number") return m;
  if (typeof m === "string") {
    const n = Number(m);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const getPriorityLevel = (t) => {
  const raw = t.priority ?? t.priorityLevel ?? t.priorityLabel ?? null;
  if (raw == null) return null;
  if (typeof raw === "number") return raw;
  if (raw === "高") return 3;
  if (raw === "中") return 2;
  if (raw === "低") return 1;
  return raw;
};
const getPriorityLabel = (t) => {
  const p = getPriorityLevel(t);
  if (typeof p === "number") return p >= 3 ? "高" : p === 2 ? "中" : "低";
  if (typeof p === "string") return p;
  return null;
};

const getScaleLevel = (t) => {
  const raw = t.scale ?? t.size ?? t.scaleLevel ?? t.sizeLevel ?? null;
  if (raw == null) return null;
  if (typeof raw === "number") return raw;
  if (raw === "大") return 3;
  if (raw === "中") return 2;
  if (raw === "小") return 1;
  return raw;
};
const getScaleLabel = (t) => {
  const s = getScaleLevel(t);
  if (typeof s === "number") return s >= 3 ? "大" : s === 2 ? "中" : "小";
  if (typeof s === "string") return s;
  return null;
};

const fmtDateTime = (d) => (d ? format(d, "M/d HH:mm") : null);

// Firestore Timestamp / Date を Date に正規化
const toDateMaybe = (x) => {
  if (!x) return null;
  if (typeof x.toDate === "function") return x.toDate();
  if (x instanceof Date) return x;
  return null;
};

// 調整情報（startRaw→startRecommend）を整形
const adjustInfo = (t) => {
  const sr = toDateMaybe(t.startRecommend);
  const raw = toDateMaybe(t.startRaw);
  if (!sr || !raw) return null;

  const diffMin = Math.round((raw.getTime() - sr.getTime()) / 60000); // +:前倒し / -:繰り下げ
  if (diffMin === 0) return null;

  const ex = t.explain || {};
  const reasons = [];
  // 時間帯（通知可能×作業可能）の丸め
  if (ex.decidedStartIso && ex.latestStartIso_effective) reasons.push("時間帯調整");
  // キャパ/衝突回避で latestAllowed に吸着
  if (ex.nonOverlapGuard?.latestAllowedIso && ex.decidedStartIso) {
    const la = new Date(ex.nonOverlapGuard.latestAllowedIso).getTime();
    const ds = new Date(ex.decidedStartIso).getTime();
    if (la === ds) reasons.push("キャパ/衝突回避");
  }

  return {
    sr,
    raw,
    diffMin,
    direction: diffMin > 0 ? "前倒し" : "繰り下げ",
    reasons: reasons.join(" / "),
  };
};

/* =============================== */

const TodoCalendar = ({ todos }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [activeTab, setActiveTab] = useState("deadline"); // "deadline" | "working"

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

  // その日が「締切」のタスク
  const deadlineTasksForSelected = useMemo(() => {
    if (!selectedDate) return [];
    return (todos ?? []).filter((t) => {
      const d = getDeadline(t);
      return d && isSameDay(d, selectedDate);
    });
  }, [todos, selectedDate]);

  // その日に「取り組むべき」タスク（通知日〜締切の期間中は毎日表示）
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

  const toggleComplete = async (todo) => {
    await updateDoc(doc(db, "todos", todo.id), { completed: !todo.completed });
  };
  const deleteTask = async (todo) => {
    await deleteDoc(doc(db, "todos", todo.id));
  };

  return (
    <div className="calendar-wrapper">
      {/* 左カラム内にパネルを重ねるため relative を付与 */}
      <div
        className="calendar-box"
        style={{ height: 540, position: "relative" }}
      >
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
          onSelectSlot={(slotInfo) => {
            setSelectedDate(slotInfo.start);
            setActiveTab("deadline");
          }}
          messages={{ month: "月表示", today: "今日", previous: "前", next: "次" }}
          eventPropGetter={(event) => ({
            className: event.completed ? "event-completed" : "event-active",
          })}
          style={{ height: "100%" }}
        />

        {/* === 左上固定パネル === */}
        {selectedDate && (
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
              zIndex: 5, // 左カラム内のみ
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
              <h3 style={{ margin: 0 }}>
                {format(selectedDate, "yyyy年M月d日")}
              </h3>
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
                <button
                  className="btn btn-close"
                  onClick={() => setSelectedDate(null)}
                  style={{ marginLeft: 8 }}
                >
                  閉じる
                </button>
              </div>
            </div>

            {/* 締切タスク */}
            {activeTab === "deadline" && (
              <>
                {deadlineTasksForSelected.length === 0 ? (
                  <p className="empty">なし</p>
                ) : (
                  <ul className="modal-task-list rich">
                    {deadlineTasksForSelected.map((t) => {
                      const dl = getDeadline(t);
                      const nt = getNotifyAt(t);
                      const req = getReqMinutes(t);
                      const E = getEstimatedMinutesE(t);
                      const pri = getPriorityLabel(t);
                      const sca = getScaleLabel(t);
                      const adj = adjustInfo(t);
                      return (
                        <li key={t.id} className="modal-task-item rich">
                          <div className="left">
                            <label className="checkbox-row">
                              <input
                                type="checkbox"
                                checked={!!t.completed}
                                onChange={() => toggleComplete(t)}
                              />
                              <span className={t.completed ? "is-done" : ""}>
                                {t.text}
                              </span>
                            </label>

                            <div className="meta-row">
                              {dl && (
                                <span className="meta">
                                  <span className="meta-label">締切</span>
                                  <span className="meta-value">
                                    {format(dl, "yyyy/M/d HH:mm")}
                                  </span>
                                </span>
                              )}
                              {nt && (
                                <span className="meta">
                                  <span className="meta-label">通知</span>
                                  <span className="meta-value">
                                    {fmtDateTime(nt)}
                                  </span>
                                </span>
                              )}
                              {typeof E === "number" && (
                                <span className="meta">
                                  <span className="meta-label">E（所要）</span>
                                  <span className="meta-value">
                                    {E} 分
                                  </span>
                                </span>
                              )}
                              {typeof req === "number" && (
                                <span className="meta">
                                  <span className="meta-label">想定所要</span>
                                  <span className="meta-value">
                                    約 {req} 分（≒ {(req / 60).toFixed(1)} 時間）
                                  </span>
                                </span>
                              )}
                              {adj && (
                                <span
                                  className="meta"
                                  title={`理由: ${adj.reasons || "—"}`}
                                >
                                  <span className="meta-label">調整</span>
                                  <span className="meta-value">
                                    {format(adj.raw, "M/d HH:mm")} → {format(adj.sr, "M/d HH:mm")}（{Math.abs(adj.diffMin)}分 {adj.direction}）
                                  </span>
                                </span>
                              )}
                            </div>

                            <div className="chip-row">
                              {pri && (
                                <span className={`chip chip-pri-${pri}`}>
                                  優先度: {pri}
                                </span>
                              )}
                              {sca && (
                                <span className={`chip chip-sca-${sca}`}>
                                  規模: {sca}
                                </span>
                              )}
                              {adj && <span className="chip">調整済</span>}
                            </div>
                          </div>

                          <div className="right">
                            <button
                              className="icon-btn delete-btn"
                              title="削除"
                              onClick={() => deleteTask(t)}
                            >
                              🗑️
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}

            {/* 取り組むタスク */}
            {activeTab === "working" && (
              <>
                {workingTasksForSelected.length === 0 ? (
                  <p className="empty">なし</p>
                ) : (
                  <ul className="modal-task-list rich">
                    {workingTasksForSelected.map((t) => {
                      const dl = getDeadline(t);
                      const nt = getNotifyAt(t);
                      const req = getReqMinutes(t);
                      const E = getEstimatedMinutesE(t);
                      const pri = getPriorityLabel(t);
                      const sca = getScaleLabel(t);
                      const rowDone = !!t.completed;
                      const adj = adjustInfo(t);
                      return (
                        <li
                          key={t.id}
                          className={`modal-task-item rich ${
                            rowDone ? "row-done" : ""
                          }`}
                        >
                          <div className="left">
                            <label className="checkbox-row">
                              <input
                                type="checkbox"
                                checked={!!t.completed}
                                onChange={() => toggleComplete(t)}
                              />
                              <span className={rowDone ? "is-done" : ""}>
                                {t.text}
                              </span>
                            </label>

                            <div className="meta-row">
                              {nt && (
                                <span className="meta">
                                  <span className="meta-label">通知</span>
                                  <span className="meta-value">
                                    {fmtDateTime(nt)}
                                  </span>
                                </span>
                              )}
                              {dl && (
                                <span className="meta">
                                  <span className="meta-label">締切</span>
                                  <span className="meta-value">
                                    {format(dl, "yyyy/M/d HH:mm")}
                                  </span>
                                </span>
                              )}
                              {typeof E === "number" && (
                                <span className="meta">
                                  <span className="meta-label">E（所要）</span>
                                  <span className="meta-value">
                                    {E} 分
                                  </span>
                                </span>
                              )}
                              {typeof req === "number" && (
                                <span className="meta">
                                  <span className="meta-label">想定所要</span>
                                  <span className="meta-value">
                                    約 {req} 分（≒ {(req / 60).toFixed(1)} 時間）
                                  </span>
                                </span>
                              )}
                              {adj && (
                                <span
                                  className="meta"
                                  title={`理由: ${adj.reasons || "—"}`}
                                >
                                  <span className="meta-label">調整</span>
                                  <span className="meta-value">
                                    {format(adj.raw, "M/d HH:mm")} → {format(adj.sr, "M/d HH:mm")}（{Math.abs(adj.diffMin)}分 {adj.direction}）
                                  </span>
                                </span>
                              )}
                            </div>

                            <div className="chip-row">
                              {pri && (
                                <span className={`chip chip-pri-${pri}`}>
                                  優先度: {pri}
                                </span>
                              )}
                              {sca && (
                                <span className={`chip chip-sca-${sca}`}>
                                  規模: {sca}
                                </span>
                              )}
                              {adj && <span className="chip">調整済</span>}
                            </div>
                          </div>

                          <div className="right">
                            <button
                              className="icon-btn delete-btn"
                              title="削除"
                              onClick={() => deleteTask(t)}
                            >
                              🗑️
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TodoCalendar;
