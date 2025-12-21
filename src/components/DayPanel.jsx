// src/components/DayPanel.jsx
import { useState, useEffect, useCallback } from "react";

/**
 * カレンダー日付から開くクイック追加モーダル（最小構成版）
 * - 入力: タイトル, 締切時刻, E(見積分), ラベル
 * - 作成時: actualTotalMinutes を 0 で初期化
 * - Firestore への保存は親の onAdd に委譲
 */
export default function DayPanel({
  selectedDate,
  onAdd,     // (payload) => Promise<void>
  onClose,
  labels = [], // [{id, name, color}]
}) {
  const [saving, setSaving] = useState(false);

  // 入力UI
  const [qText, setQText] = useState("");
  const [qTime, setQTime] = useState("18:00");
  const [qE, setQE] = useState("90");            // E（見積分）
  const [qLabelId, setQLabelId] = useState("");
  const [qPlannedStart, setQPlannedStart] = useState("");

  // ラベルが削除されていた場合の安全対処
  useEffect(() => {
    if (qLabelId && !labels.find((l) => l.id === qLabelId)) {
      setQLabelId("");
    }
  }, [labels, qLabelId]);

  const reset = () => {
    setQText("");
    setQTime("18:00");
    setQE("90");
    setQLabelId("");
    setQPlannedStart("");
  };

  const handleClose = useCallback(() => {
    if (!saving) onClose?.();
  }, [onClose, saving]);

  // ESCで閉じる
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && handleClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) handleClose();
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!selectedDate || !qText.trim() || !onAdd || saving) return;

    // 必須: E
    const E = Math.round(Number(qE));
    if (!Number.isFinite(E) || E <= 0) {
      alert("E（見積分）は正の数で入力してください。");
      return;
    }

    // 締切日時 = selectedDate + qTime
    const [hh, mm] = (qTime || "00:00").split(":").map((s) => parseInt(s, 10) || 0);
    const deadline = new Date(
      selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(),
      hh, mm, 0, 0
    );

    const plannedStart = qPlannedStart ? new Date(qPlannedStart) : null;

    const payload = {
      text: qText.trim(),
      deadline,
      plannedStart,
      estimatedMinutes: E,         // 見積所要時間E
      labelId: qLabelId || null,   // 任意
      actualTotalMinutes: 0,       // 実績は後から入力
    };

    try {
      setSaving(true);
      await onAdd(payload); // 親（App/TodoCalendar）に委譲
      reset();
      handleClose();
    } catch (err) {
      console.error("quick add failed:", err);
      alert("追加に失敗しました。もう一度お試しください。");
    } finally {
      setSaving(false);
    }
  };

  // ───── UIスタイル ─────
  const overlayStyle = {
    position: "absolute",
    inset: 0,
    background: "rgba(0,0,0,0.20)",
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  };
  const modalStyle = {
    position: "relative",
    width: "min(720px, calc(100vw - 32px))",
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 12px 28px rgba(0,0,0,0.18)",
    padding: 16,
  };
  const headerStyle = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  };
  const titleStyle = { fontSize: "1rem", fontWeight: 700, margin: 0, lineHeight: 1.2 };
  const closeBtnStyle = {
    marginLeft: "auto",
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid #ddd",
    background: "#f8f8f8",
    cursor: "pointer",
  };
  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #ddd",
    borderRadius: 10,
    fontSize: "0.95rem",
  };
  const labelStyle = { display: "block", fontSize: ".85rem", marginBottom: 6, color: "#555" };

  return (
    <div
      className="quick-modal-overlay"
      style={overlayStyle}
      onMouseDown={handleBackdropClick}
    >
      <div
        className="quick-modal"
        style={modalStyle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div style={headerStyle}>
          <h3 style={titleStyle}>
            {selectedDate
              ? `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日が締め切りのタスク`
              : "タスク追加"}
          </h3>
          <button type="button" onClick={handleClose} style={closeBtnStyle}>
            閉じる
          </button>
        </div>

        {/* フォーム */}
        <form onSubmit={handleSubmit}>
          {/* 1行目：テキスト & 時刻 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 10 }}>
            <input
              type="text"
              placeholder="やること"
              value={qText}
              onChange={(e) => setQText(e.target.value)}
              style={inputStyle}
              required
            />
            <input
              type="time"
              value={qTime}
              onChange={(e) => setQTime(e.target.value)}
              style={inputStyle}
              required
            />
          </div>

          {/* 2行目：E・ラベル */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 10,
              marginTop: 10,
            }}
          >
            <div>
              <label style={labelStyle}>E（見積分） *</label>
              <input
                type="number"
                min="1"
                step="1"
                placeholder="例: 90"
                value={qE}
                onChange={(e) => setQE(e.target.value)}
                style={inputStyle}
                required
              />
            </div>
            <div>
              <label style={labelStyle}>開始予定日（任意）</label>
              <input
                type="date"
                value={qPlannedStart}
                onChange={(e) => setQPlannedStart(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>ラベル</label>
              <select
                value={qLabelId}
                onChange={(e) => setQLabelId(e.target.value)}
                style={inputStyle}
              >
                <option value="">（ラベルなし）</option>
                {labels.map((lb) => (
                  <option key={lb.id} value={lb.id}>{lb.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 送信 */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, gap: 8 }}>
            <button type="button" onClick={handleClose} style={{ ...closeBtnStyle, background: "#fff" }}>
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid #2e7d32",
                background: saving ? "#9ccc9c" : "#43a047",
                color: "#fff",
                cursor: saving ? "default" : "pointer",
                fontWeight: 600,
              }}
            >
              {saving ? "追加中…" : "追加"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
