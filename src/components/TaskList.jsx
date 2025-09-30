// src/components/TaskList.jsx
import { format } from "date-fns";
import { doc, updateDoc, deleteDoc } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";

import {
  getDeadline,
  getNotifyAt,
  getEstimatedMinutesE,
  getReqMinutes,
  getPriorityLabel,
  getScaleLabel,
  fmtDateTime,
  adjustInfo,
} from "../utils/calendarHelpers";

/**
 * @param {Object}   props
 * @param {Array}    props.tasks - 表示するタスク配列
 * @param {"deadline"|"working"} props.mode - 表示モード
 */
export default function TaskList({ tasks, mode }) {
  const toggleComplete = async (todo) => {
    const assignments = Array.isArray(todo?.dailyAssignments)
      ? todo.dailyAssignments
      : [];
    const nextCompleted = !todo.completed;
    const progressUpdate = {};
    assignments.forEach((assignment) => {
      if (!assignment?.date) return;
      progressUpdate[`dailyProgress.${assignment.date}`] = nextCompleted;
    });
    try {
      await updateDoc(doc(db, "todos", todo.id), {
        completed: nextCompleted,
        ...progressUpdate,
      });
    } catch (error) {
      console.error("toggle task complete failed", error);
    }
  };
  const deleteTask = async (todo) => {
    await deleteDoc(doc(db, "todos", todo.id));
  };

  if (!tasks || tasks.length === 0) {
    return <p className="empty">なし</p>;
  }

  return (
    <ul className="modal-task-list rich">
      {tasks.map((t) => {
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
            className={`modal-task-item rich ${rowDone ? "row-done" : ""}`}
          >
            <div className="left">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={!!t.completed}
                  onChange={() => toggleComplete(t)}
                />
                <span className={rowDone ? "is-done" : ""}>{t.text}</span>
              </label>

              <div className="meta-row">
                {/* 表示順は mode に合わせる */}
                {mode === "working" ? (
                  <>
                    {nt && (
                      <span className="meta">
                        <span className="meta-label">通知</span>
                        <span className="meta-value">{fmtDateTime(nt)}</span>
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
                  </>
                ) : (
                  <>
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
                        <span className="meta-value">{fmtDateTime(nt)}</span>
                      </span>
                    )}
                  </>
                )}

                {typeof E === "number" && (
                  <span className="meta">
                    <span className="meta-label">E（所要）</span>
                    <span className="meta-value">{E} 分</span>
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
                  <span className="meta" title={`理由: ${adj.reasons || "—"}`}>
                    <span className="meta-label">調整</span>
                    <span className="meta-value">
                      {format(adj.raw, "M/d HH:mm")} →{" "}
                      {format(adj.sr, "M/d HH:mm")}
                      （{Math.abs(adj.diffMin)}分 {adj.direction}）
                    </span>
                  </span>
                )}
              </div>

              <div className="chip-row">
                {pri && (
                  <span className={`chip chip-pri-${pri}`}>重要度: {pri}</span>
                )}
                {sca && (
                  <span className={`chip chip-sca-${sca}`}>w: {sca}</span>
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
  );
}
