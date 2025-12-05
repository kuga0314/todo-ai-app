import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";

const overlayStyle = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(0, 0, 0, 0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1200,
};

const modalStyle = {
  background: "#fff",
  padding: 20,
  borderRadius: 12,
  width: "min(640px, 90vw)",
  maxHeight: "80vh",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
};

const headerStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 12,
};

const sectionTitleStyle = {
  fontSize: 14,
  fontWeight: 700,
  color: "#334155",
  margin: "16px 0 8px",
};

const buttonStyle = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 16px",
  fontWeight: 700,
  cursor: "pointer",
};

const ghostButtonStyle = {
  background: "transparent",
  border: "none",
  color: "#475569",
  padding: 6,
  cursor: "pointer",
};

const FeedbackModal = ({ open, onClose, user }) => {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedbacks, setFeedbacks] = useState([]);
  const [error, setError] = useState(null);

  const canSubmit = useMemo(() => {
    return title.trim().length > 0 && content.trim().length > 0 && !submitting;
  }, [title, content, submitting]);

  useEffect(() => {
    if (!open || !user?.uid) return undefined;

    const q = query(collection(db, "feedbacks"), where("userId", "==", user.uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const getMillis = (value) => {
          if (!value) return 0;
          if (typeof value.toMillis === "function") return value.toMillis();
          if (value instanceof Date) return value.getTime();
          if (typeof value === "number") return value;
          const parsed = Date.parse(value);
          return Number.isNaN(parsed) ? 0 : parsed;
        };

        const rows = snap.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() ?? {}) }))
          .sort((a, b) => getMillis(b?.createdAt) - getMillis(a?.createdAt));
        setFeedbacks(rows);
        setError(null);
      },
      (err) => {
        console.error("failed to fetch feedbacks", err);
        setError("送信履歴の読み込みに失敗しました");
      }
    );

    return () => unsub();
  }, [open, user?.uid]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit || !user?.uid) return;

    setSubmitting(true);
    try {
      await addDoc(collection(db, "feedbacks"), {
        userId: user.uid,
        userEmail: user.email || null,
        title: title.trim(),
        content: content.trim(),
        createdAt: serverTimestamp(),
      });
      setTitle("");
      setContent("");
      setError(null);
    } catch (err) {
      console.error("failed to submit feedback", err);
      setError("送信に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (ts) => {
    if (!ts) return "";
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  };

  if (!open) return null;

  return (
    <div
      className="floating-overlay"
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="floating-overlay__surface"
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={headerStyle}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>開発者へのフィードバック</div>
            <p style={{ margin: "4px 0 0", color: "#475569", fontSize: 13 }}>
              使い心地や改善案、気になった点などをお聞かせください。
            </p>
          </div>
          <button onClick={onClose} style={ghostButtonStyle} aria-label="閉じる">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label style={{ fontWeight: 700, fontSize: 13, color: "#334155" }}>
              タイトル
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例）通知のタイミングについて"
              style={{
                width: "100%",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "10px 12px",
                marginTop: 6,
              }}
            />
          </div>

          <div>
            <label style={{ fontWeight: 700, fontSize: 13, color: "#334155" }}>
              内容
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="いつ送ってもOKです。詳細を教えてください。"
              rows={5}
              style={{
                width: "100%",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: 12,
                marginTop: 6,
                resize: "vertical",
              }}
            />
          </div>

          {error && (
            <div style={{ color: "#b91c1c", fontSize: 13, marginTop: 4 }}>{error}</div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" onClick={onClose} style={{ ...ghostButtonStyle, padding: "10px 12px" }}>
              キャンセル
            </button>
            <button type="submit" style={buttonStyle} disabled={!canSubmit}>
              {submitting ? "送信中..." : "送信する"}
            </button>
          </div>
        </form>

        <div style={{ overflowY: "auto", marginTop: 8, paddingRight: 4 }}>
          <div style={sectionTitleStyle}>これまでの送信履歴</div>
          {feedbacks.length === 0 && (
            <p style={{ color: "#94a3b8", fontSize: 13 }}>まだ送信履歴はありません。</p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {feedbacks.map((row) => (
              <div
                key={row.id}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: 10,
                  background: "#f8fafc",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 700 }}>{row.title}</div>
                  <span style={{ fontSize: 12, color: "#64748b" }}>{formatDate(row.createdAt)}</span>
                </div>
                <p style={{ whiteSpace: "pre-wrap", marginTop: 6, color: "#334155" }}>{row.content}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FeedbackModal;
