// src/components/DayPanel.jsx
import React, { useMemo, useState } from "react";
import { format, isSameDay, startOfDay, endOfDay } from "date-fns";
import { collection, addDoc, Timestamp } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { useAuth } from "../hooks/useAuth"; // userId を付けるため
import TaskList from "./TaskList";
import { getDeadline, getNotifyAt } from "../utils/calendarHelpers";

/**
 * カレンダーで日付をクリックすると出る左上パネル。
 * 「＋」を押すと入力欄だけ表示→送信で Firestore に直接 addDoc。
 * App 側の onSnapshot が拾うのでリスト/カレンダーに即反映されます。
 */
export default function DayPanel({ selectedDate, todos, onClose }) {
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState("deadline"); // "deadline" | "working"
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  // 入力状態
  const [qText, setQText] = useState("");
  const [qTime, setQTime] = useState("18:00");
  const [qE, setQE] = useState("90");
  const [qScale, setQScale] = useState(3);
  const [qPriority, setQPriority] = useState(2);
  const [saving, setSaving] = useState(false);

  const resetQuickAdd = () => {
    setQText("");
    setQTime("18:00");
    setQE("90");
    setQScale(3);
    setQPriority(2);
  };

  /* --- 当日締切タスク --- */
  const deadlineTasksForSelected = useMemo(() => {
    if (!selectedDate) return [];
    return (todos ?? []).filter((t) => {
      const d = getDeadline(t);
      return d && isSameDay(d, selectedDate);
    });
  }, [todos, selectedDate]);

  /* --- 通知〜締切の期間中は毎日表示（取り組むタスク） --- */
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

  /* --- その日締切で追加（TodoInput と同じ形で保存） --- */
  const handleQuickAdd = async (e) => {
    e?.preventDefault?.();
    if (!user?.uid || !selectedDate || !qText.trim() || saving) return;

    try {
      setSaving(true);
      // selectedDate(年月日) + qTime(HH:mm) を締切にする
      const [hh, mm] = (qTime || "00:00").split(":").map((s) => parseInt(s, 10) || 0);
      const dl = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate(),
        hh,
        mm,
        0,
        0
      );

      await addDoc(collection(db, "todos"), {
        userId: user.uid,                            // ← Appの購読 where("userId","==",uid) と一致
        text: qText.trim(),
        completed: false,
        deadline: Timestamp.fromDate(dl),            // ← カレンダーは締切ベースで描画
        scale: Number(qScale),
        priority: Number(qPriority),
        // TodoInput と同じく E（分）を最優先で保存（未入力なら別途フォールバックしている実装）
        estimatedMinutes: Number(qE) > 0 ? Math.round(Number(qE)) : null,
        notified: false,
        createdAt: Timestamp.now(),
        // startRecommend / explain は Cloud Functions で付与される想定
      });

      resetQuickAdd();
      setShowQuickAdd(false); // 送信後はフォームを閉じる
      // onSnapshot（App.jsx）で自動的にリスト/カレンダーへ反映されます
    } catch (err) {
      console.error("quick add failed:", err);
      alert("追加に失敗しました。もう一度お試しください。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="day-panel-left card"
      style={{
        position: "absolute",
        left: 12,
        top: 12,
        width: "clamp(360px, 92vw, 520px)",
        maxHeight: "calc(100% - 24px)",
        overflowY: "auto",
        overflowX: "hidden",
        background: "#fff",
        borderRadius: 14,
        boxShadow: "0 10px 24px rgba(0,0,0,.15)",
        zIndex: 5,
        boxSizing: "border-box",
      }}
    >
      {/* ヘッダー */}
      <div
        className="modal-head"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 8,
          padding: "8px 10px 0 10px",
        }}
      >
        <h3 style={{ margin: 0 }}>{format(selectedDate, "yyyy年M月d日")}</h3>

        {!showQuickAdd ? (
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

            {/* ＋：入力欄だけ表示（リストは隠す） */}
            <button
              className="btn btn-close"
              onClick={() => setShowQuickAdd(true)}
              style={{ marginLeft: 8, background: "#4f8bff" }}
              title="この日が締切のタスクを追加"
            >
              ＋
            </button>

            <button className="btn btn-close" onClick={onClose} style={{ marginLeft: 8 }}>
              閉じる
            </button>
          </div>
        ) : (
          <div className="tab-controls" aria-label="入力モード">
            <button
              className="btn btn-close"
              onClick={() => (resetQuickAdd(), setShowQuickAdd(false))}
              style={{ background: "#9aa0aa" }}
              title="入力をやめる"
            >
              キャンセル
            </button>
            <button className="btn btn-close" onClick={onClose} style={{ marginLeft: 8 }}>
              閉じる
            </button>
          </div>
        )}
      </div>

      {/* 本体：入力モードならフォームだけ／通常はタブに応じたリスト */}
      {showQuickAdd ? (
        <form onSubmit={handleQuickAdd} style={{ padding: "10px", boxSizing: "border-box" }}>
          {/* 1行目: タスク名 + 時刻 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 10 }}>
            <input
              autoFocus
              type="text"
              placeholder="やること（必須）"
              value={qText}
              onChange={(e) => setQText(e.target.value)}
              required
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #e5e7eb",
                fontSize: ".95rem",
                minWidth: 0,
              }}
            />
            <input
              type="time"
              value={qTime}
              onChange={(e) => setQTime(e.target.value)}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #e5e7eb",
                fontSize: ".95rem",
                minWidth: 0,
              }}
            />
          </div>

          {/* 2行目: E・規模・優先度 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 10,
              marginTop: 10,
            }}
          >
            <input
              type="number"
              min="1"
              step="1"
              placeholder="E（分）"
              value={qE}
              onChange={(e) => setQE(e.target.value)}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #e5e7eb",
                fontSize: ".95rem",
                minWidth: 0,
              }}
            />
            <select
              value={qScale}
              onChange={(e) => setQScale(e.target.value)}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #e5e7eb",
                fontSize: ".95rem",
                minWidth: 0,
              }}
            >
              <option value={1}>規模: 小</option>
              <option value={2}>規模: 中</option>
              <option value={3}>規模: 大</option>
              <option value={4}>規模: 特大</option>
              <option value={5}>規模: 超特大</option>
            </select>
            <select
              value={qPriority}
              onChange={(e) => setQPriority(e.target.value)}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #e5e7eb",
                fontSize: ".95rem",
                minWidth: 0,
              }}
            >
              <option value={1}>優先度: 低</option>
              <option value={2}>優先度: 中</option>
              <option value={3}>優先度: 高</option>
            </select>
          </div>

          {/* 3行目: 追加ボタン */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button type="submit" className="btn btn-close" disabled={saving}>
              {saving ? "追加中…" : "追加"}
            </button>
          </div>
        </form>
      ) : activeTab === "deadline" ? (
        <TaskList tasks={deadlineTasksForSelected} mode="deadline" />
      ) : (
        <TaskList tasks={workingTasksForSelected} mode="working" />
      )}
    </div>
  );
}
