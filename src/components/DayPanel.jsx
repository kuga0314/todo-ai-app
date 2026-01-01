// src/components/DayPanel.jsx
import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, NotePencil } from "phosphor-react";

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
  const [memoText, setMemoText] = useState("");
  const [isMemoPage, setIsMemoPage] = useState(false);
  const [slideDirection, setSlideDirection] = useState(null); // forward: main -> memo, back: memo -> main

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
    setMemoText("");
    setIsMemoPage(false);
    setSlideDirection(null);
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
      memo: memoText.trim(),
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
      <style>{`
        @keyframes memo-slide-from-left {
          from { opacity: 0; transform: translateX(-12px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes memo-slide-from-right {
          from { opacity: 0; transform: translateX(12px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}
      </style>
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
          {isMemoPage ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                animation: slideDirection === "forward"
                  ? "memo-slide-from-left 220ms ease"
                  : "memo-slide-from-right 220ms ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => {
                    setSlideDirection("back");
                    setIsMemoPage(false);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    borderRadius: 10,
                    border: "1px solid #e2e8f0",
                    background: "#f1f5f9",
                    color: "#0f172a",
                    fontWeight: 600,
                    width: "fit-content",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
                  }}
                >
                  <ArrowLeft size={18} weight="bold" />
                </button>
                <span style={{ ...labelStyle, margin: 0, fontWeight: 700, color: "#0f172a" }}>タスクメモ</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <textarea
                  value={memoText}
                  onChange={(e) => setMemoText(e.target.value)}
                  placeholder=""
                  style={{
                    ...inputStyle,
                    minHeight: 140,
                    resize: "vertical",
                    fontSize: "0.95rem",
                    lineHeight: 1.5,
                    background: "#f8fafc",
                  }}
                />
              </div>
            </div>
          ) : (
            <>
              {/* 1行目：テキスト & 時刻 */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 160px",
                  gap: 10,
                  animation: slideDirection === "back" ? "memo-slide-from-right 220ms ease" : undefined,
                }}
              >
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

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginTop: 12,
                  padding: "10px 12px",
                  border: "1px dashed #cbd5e1",
                  borderRadius: 10,
                  background: "#f8fafc",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 13, color: "#475569", fontWeight: 700 }}>メモ</span>
                  <span style={{ fontSize: 13, color: memoText ? "#0f172a" : "#94a3b8" }}>
                    {memoText ? `保存予定: ${memoText}` : "タスクに添えるメモを追加できます"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSlideDirection("forward");
                    setIsMemoPage(true);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid #0ea5e9",
                    background: "#e0f2fe",
                    color: "#0b75c9",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  <NotePencil size={18} weight="fill" />
                  メモを書く
                </button>
              </div>
            </>
          )}

          {/* 送信 */}
          {!isMemoPage && (
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
          )}
        </form>
      </div>
    </div>
  );
}
