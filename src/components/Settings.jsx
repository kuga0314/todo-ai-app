// src/components/Settings.jsx
import { useEffect, useState } from "react";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  deleteDoc,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { useAuth } from "../hooks/useAuth";

/**
 * 設定ページ
 * - 通知設定
 * - ラベル管理
 */
export default function Settings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);

  /* ───── 通知設定 ───── */
  const [progressReminderTime, setProgressReminderTime] = useState("21:00");
  const [morningSummaryEnabled, setMorningSummaryEnabled] = useState(false);
  const [morningSummaryTime, setMorningSummaryTime] = useState("07:30");
  const [riskNotifyEnabled, setRiskNotifyEnabled] = useState(true);
  const [countdownEnabled, setCountdownEnabled] = useState(true);
  const [inactiveNudgeEnabled, setInactiveNudgeEnabled] = useState(true);

  /* ───── ラベル管理 ───── */
  const [labels, setLabels] = useState([]);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#2196f3");

  /* 通知設定読込 */
  useEffect(() => {
    if (!user?.uid) return;
    const ref = doc(db, "users", user.uid, "settings", "notification");
    getDoc(ref).then((snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setProgressReminderTime(d.progressReminderTime || "21:00");
        setMorningSummaryEnabled(!!d.morningSummaryTime);
        setMorningSummaryTime(d.morningSummaryTime || "07:30");
        setRiskNotifyEnabled(d.riskNotifyEnabled ?? true);
        setCountdownEnabled(d.countdownEnabled ?? true);
        setInactiveNudgeEnabled(d.inactiveNudgeEnabled ?? true);
      }
      setLoading(false);
    });
  }, [user?.uid]);

  const saveNotificationSettings = async () => {
    if (!user?.uid) return;
    const ref = doc(db, "users", user.uid, "settings", "notification");
    await setDoc(
      ref,
      {
        progressReminderTime,
        morningSummaryTime: morningSummaryEnabled ? morningSummaryTime : null,
        riskNotifyEnabled,
        countdownEnabled,
        inactiveNudgeEnabled,
      },
      { merge: true }
    );
    alert("通知設定を保存しました");
  };

  /* ラベル購読 */
  useEffect(() => {
    if (!user?.uid) return;
    const q = collection(db, "users", user.uid, "labels");
    const unsub = onSnapshot(q, (snap) => {
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
      setLabels(rows);
    });
    return () => unsub();
  }, [user?.uid]);

  const addLabel = async () => {
    if (!user?.uid || !newLabelName.trim()) return;
    try {
      await addDoc(collection(db, "users", user.uid, "labels"), {
        name: newLabelName.trim(),
        color: newLabelColor,
      });
      setNewLabelName("");
    } catch (e) {
      console.error("add label failed", e);
    }
  };

  const deleteLabel = async (id) => {
    if (!user?.uid || !id) return;
    if (!window.confirm("ラベルを削除しますか？")) return;
    try {
      await deleteDoc(doc(db, "users", user.uid, "labels", id));
    } catch (e) {
      console.error("delete label failed", e);
    }
  };

  if (loading) return <p>読み込み中…</p>;

  return (
    <div className="settings">
      <h2>設定</h2>

      {/* 通知設定 */}
      <section className="card" style={{ marginBottom: 20 }}>
        <h3>通知設定</h3>
        <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
          <label>
            日次進捗リマインド時刻:
            <input
              type="time"
              value={progressReminderTime}
              onChange={(e) => setProgressReminderTime(e.target.value)}
              style={{ marginLeft: 8 }}
            />
          </label>

          <label>
            <input
              type="checkbox"
              checked={morningSummaryEnabled}
              onChange={(e) => setMorningSummaryEnabled(e.target.checked)}
            />
            朝プラン通知
          </label>
          {morningSummaryEnabled && (
            <input
              type="time"
              value={morningSummaryTime}
              onChange={(e) => setMorningSummaryTime(e.target.value)}
              style={{ marginLeft: 24 }}
            />
          )}

          <label>
            <input
              type="checkbox"
              checked={riskNotifyEnabled}
              onChange={(e) => setRiskNotifyEnabled(e.target.checked)}
            />
            遅延リスク通知を受け取る
          </label>

          <label>
            <input
              type="checkbox"
              checked={countdownEnabled}
              onChange={(e) => setCountdownEnabled(e.target.checked)}
            />
            締切カウントダウン通知を受け取る
          </label>

          <label>
            <input
              type="checkbox"
              checked={inactiveNudgeEnabled}
              onChange={(e) => setInactiveNudgeEnabled(e.target.checked)}
            />
            無活動アラートを受け取る
          </label>
        </div>
        <button
          onClick={saveNotificationSettings}
          style={{ marginTop: 12, padding: "8px 16px" }}
        >
          保存
        </button>
      </section>

      {/* ラベル管理 */}
      <section className="card">
        <h3>ラベル管理</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            placeholder="ラベル名"
            value={newLabelName}
            onChange={(e) => setNewLabelName(e.target.value)}
          />
          <input
            type="color"
            value={newLabelColor}
            onChange={(e) => setNewLabelColor(e.target.value)}
          />
          <button onClick={addLabel}>追加</button>
        </div>

        {labels.length === 0 ? (
          <p style={{ color: "#666" }}>ラベルはまだありません。</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {labels.map((lb) => (
              <li
                key={lb.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  border: "1px solid #eee",
                  borderRadius: 8,
                  padding: "6px 10px",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      background: lb.color,
                      display: "inline-block",
                    }}
                  />
                  {lb.name}
                </span>
                <button onClick={() => deleteLabel(lb.id)}>削除</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
