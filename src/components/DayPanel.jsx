// src/components/DayPanel.jsx
import { useState, useEffect, useCallback } from "react";
import { collection, addDoc, onSnapshot, Timestamp } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { useAuth } from "../hooks/useAuth";

/**
 * 仕様:
 * - 画面左上（固定位置）に出るモーダル。背面に半透明のオーバーレイ。
 * - クリックで外側を押す/ESCキーで閉じる。
 * - クイック追加フォームに O/P（任意）を追加。Mは必須。
 * - selectedDate（日付セルから渡される Date）を締切日とし、時刻はフォームの time で指定。
 */
export default function DayPanel({ selectedDate, onAdded, onClose }) {
  const { user } = useAuth();

  // 送信状態
  const [saving, setSaving] = useState(false);

  // 入力UI（クイック追加）
  const [qText, setQText] = useState("");
  const [qTime, setQTime] = useState("18:00");
  const [qE, setQE] = useState("90");        // M（分）必須
  const [qScale, setQScale] = useState(3);   // UI上は「w」表示（保存キーは scale）
  const [qPriority, setQPriority] = useState(2); // UI上は「重要度」表示（保存キーは priority）
  const [qLabelId, setQLabelId] = useState("");
  const [qO, setQO] = useState("");          // 任意 O（分）
  const [qP, setQP] = useState("");          // 任意 P（分）

  // ラベル
  const [labels, setLabels] = useState([]);
  useEffect(() => {
    if (!user) return;
    const colRef = collection(db, "users", user.uid, "labels");
    const unsub = onSnapshot(colRef, (snap) => {
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...(d.data() ?? {}) }));
      setLabels(rows);
      if (rows.findIndex((r) => r.id === qLabelId) === -1) setQLabelId("");
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const resetQuick = () => {
    setQText("");
    setQTime("18:00");
    setQE("90");
    setQScale(3);
    setQPriority(2);
    setQLabelId("");
    setQO("");
    setQP("");
  };

  const handleClose = useCallback(() => {
    if (saving) return;
    onClose?.();
  }, [onClose, saving]);

  // ESCで閉じる
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  const handleBackdropClick = (e) => {
    // モーダル外側（オーバーレイ）クリックで閉じる（中身クリックは閉じない）
    if (e.target === e.currentTarget) handleClose();
  };

  const handleQuickAdd = async (e) => {
    e?.preventDefault?.();
    if (!user?.uid || !selectedDate || !qText.trim() || saving) return;

    // M 必須
    const M = Number(qE);
    if (!Number.isFinite(M) || M <= 0) {
      alert("M（分）は正の数で入力してください。");
      return;
    }

    // O/P 任意・妥当性チェック
    let O = qO === "" ? null : Math.round(Number(qO));
    let P = qP === "" ? null : Math.round(Number(qP));
    if (O != null && (!Number.isFinite(O) || O <= 0)) {
      alert("O（分）は正の数で入力してください。");
      return;
    }
    if (P != null && (!Number.isFinite(P) || P <= 0)) {
      alert("P（分）は正の数で入力してください。");
      return;
    }
    if (O != null && P != null && P <= O) {
      alert("P は O より大きい必要があります。");
      return;
    }

    try {
      setSaving(true);
      // selectedDate + qTime → 締切日時
      const [hh, mm] = (qTime || "00:00").split(":").map((s) => parseInt(s, 10) || 0);
      const dl = new Date(
        selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(),
        hh, mm, 0, 0
      );

      await addDoc(collection(db, "todos"), {
        userId: user.uid,
        text: qText.trim(),
        completed: false,
        deadline: Timestamp.fromDate(dl),
        scale: Number(qScale),        // ← DB上は従来どおり scale
        priority: Number(qPriority),  // ← DB上は従来どおり priority
        labelId: qLabelId || null,
        estimatedMinutes: Math.round(M), // M
        O: O ?? null,                    // 任意
        P: P ?? null,                    // 任意
        notified: false,
        createdAt: Timestamp.now(),
      });

      resetQuick();
      onAdded?.();
      handleClose();
    } catch (err) {
      console.error("quick add failed:", err);
      alert("追加に失敗しました。もう一度お試しください。");
    } finally {
      setSaving(false);
    }
  };

  // UIスタイル（モーダル左上）
  const overlayStyle = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.20)",
    zIndex: 1000,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-start",
  };
  const modalStyle = {
    position: "relative",
    marginTop: 16,        // 画面上からの距離（以前の“左上”感）
    marginLeft: 16,       // 画面左からの距離
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
  const titleStyle = {
    fontSize: "1rem",
    fontWeight: 700,
    margin: 0,
    lineHeight: 1.2,
  };
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
    <div style={overlayStyle} onMouseDown={handleBackdropClick}>
      <div style={modalStyle} onMouseDown={(e) => e.stopPropagation()}>
        {/* ヘッダー */}
        <div style={headerStyle}>
          <h3 style={titleStyle}>
            {selectedDate
              ? `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日 のタスク`
              : "タスク追加"}
          </h3>
          <button type="button" onClick={handleClose} style={closeBtnStyle}>
            閉じる
          </button>
        </div>

        {/* フォーム */}
        <form onSubmit={handleQuickAdd}>
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

          {/* 2行目：M・w・重要度 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
            <div>
              <label style={labelStyle}>M（分）*</label>
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
              <label style={labelStyle}>w</label>
              <select
                value={qScale}
                onChange={(e) => setQScale(Number(e.target.value))}
                style={inputStyle}
                aria-label="w"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>重要度</label>
              <select
                value={qPriority}
                onChange={(e) => setQPriority(Number(e.target.value))}
                style={inputStyle}
                aria-label="重要度"
              >
                <option value={1}>低</option>
                <option value={2}>中</option>
                <option value={3}>高</option>
              </select>
            </div>
          </div>

          {/* 3行目：O/P 任意 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
            <div>
              <label style={labelStyle}>O（分）任意</label>
              <input
                type="number"
                min="1"
                step="1"
                placeholder="例: 60"
                value={qO}
                onChange={(e) => setQO(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>P（分）任意</label>
              <input
                type="number"
                min="1"
                step="1"
                placeholder="例: 120"
                value={qP}
                onChange={(e) => setQP(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          {/* 4行目：ラベル */}
          <div style={{ marginTop: 10 }}>
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
