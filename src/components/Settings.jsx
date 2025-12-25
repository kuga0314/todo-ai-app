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
import VersionInfo from "./VersionInfo";
import "../styles/settings.css";
import { useTheme } from "../hooks/useTheme.jsx";

/**
 * 設定ページ
 * - 通知設定
 * - ラベル管理
 */
export default function Settings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [appMsg, setAppMsg] = useState("");
  const { themeId, setThemeId, options: themeOptions } = useTheme();

  /* ───── 通知設定 ───── */
  const [progressReminderEnabled, setProgressReminderEnabled] = useState(true);
  const [progressReminderTime, setProgressReminderTime] = useState("21:00");
  const [morningSummaryEnabled, setMorningSummaryEnabled] = useState(false);
  const [morningSummaryTime, setMorningSummaryTime] = useState("07:30");
  const [riskNotifyEnabled, setRiskNotifyEnabled] = useState(true);
  const [countdownEnabled, setCountdownEnabled] = useState(true);
  const [inactiveNudgeEnabled, setInactiveNudgeEnabled] = useState(true);

  /* ───── アプリ設定 ───── */
  const [dailyCap, setDailyCap] = useState("");
  const [selectedTheme, setSelectedTheme] = useState(themeId);

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
        const morningTime =
          d.morningPlanTime || d.morningSummaryTime || "07:30";

        const reminderEnabled =
          d.progressReminderEnabled ?? d.progressReminderTime !== null;
        const reminderTime = d.progressReminderTime || "21:00";

        setProgressReminderEnabled(reminderEnabled);
        setProgressReminderTime(reminderTime);
        setMorningSummaryEnabled(!!morningTime);
        setMorningSummaryTime(morningTime);
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
        progressReminderEnabled,
        progressReminderTime: progressReminderEnabled ? progressReminderTime : null,
        morningPlanTime: morningSummaryEnabled ? morningSummaryTime : null,
        // 互換のため既存フィールドにも書き込む
        morningSummaryTime: morningSummaryEnabled ? morningSummaryTime : null,
        riskNotifyEnabled,
        countdownEnabled,
        inactiveNudgeEnabled,
      },
      { merge: true }
    );
    alert("通知設定を保存しました");
  };

  /* アプリ設定読込 */
  useEffect(() => {
    if (!user?.uid) return;
    const ref = doc(db, "users", user.uid, "settings", "app");
    getDoc(ref).then((snap) => {
      if (!snap.exists()) {
        setDailyCap("");
        setSelectedTheme((prev) => prev || themeId);
        return;
      }
      const data = snap.data();
      const value = data?.dailyCap;
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        setDailyCap(String(Math.round(value)));
      } else {
        setDailyCap("");
      }
      const storedTheme = typeof data?.theme === "string" ? data.theme : themeId;
      setSelectedTheme(storedTheme);
      setThemeId(storedTheme);
    });
  }, [user?.uid, setThemeId]);

  const saveAppSettings = async () => {
    if (!user?.uid) return;
    setAppMsg("");
    const payload = { theme: selectedTheme };
    const ref = doc(db, "users", user.uid, "settings", "app");
    const trimmed = dailyCap.trim();

    if (!trimmed) {
      try {
        await setDoc(ref, { ...payload, dailyCap: null }, { merge: true });
        setAppMsg("保存しました");
        setThemeId(selectedTheme);
      } catch (e) {
        console.error("save app settings failed", e);
        setAppMsg("保存に失敗しました");
      }
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0 || !/^\d+$/.test(trimmed)) {
      setAppMsg("正の整数を入力してください");
      return;
    }

    const rounded = Math.round(parsed);

    try {
      await setDoc(ref, { ...payload, dailyCap: rounded }, { merge: true });
      setDailyCap(String(rounded));
      setAppMsg("保存しました");
      setThemeId(selectedTheme);
    } catch (e) {
      console.error("save app settings failed", e);
      setAppMsg("保存に失敗しました");
    }
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
    <div className="settings-container">
      <div className="settings-header">
        <h2>設定</h2>
        <p className="text-muted">通知や上限時間、ラベルをまとめて管理できます。</p>
      </div>

      {/* テーマ */}
      <section className="settings-card">
        <div className="section-title">
          <h3>テーマ</h3>
          <p className="text-muted">アプリ全体のアクセントカラーを選択できます。</p>
        </div>
        <div className="settings-grid single-column">
          <div className="field">
            <label className="field-label" htmlFor="theme">
              テーマカラー
            </label>
            <select
              id="theme"
              value={selectedTheme}
              onChange={(e) => {
                setSelectedTheme(e.target.value);
                setThemeId(e.target.value);
              }}
            >
              {themeOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="hint">6色から選択でき、保存すると端末に記憶されます。</p>
          </div>
        </div>
        <div className="settings-actions">
          <button className="btn-primary" onClick={saveAppSettings}>
            テーマを保存
          </button>
          {appMsg && (
            <p className={`save-feedback ${appMsg === "保存しました" ? "success" : "error"}`}>
              {appMsg}
            </p>
          )}
        </div>
      </section>

      {/* 通知設定 */}
      <section className="settings-card">
        <div className="section-title">
          <h3>通知設定</h3>
          <p className="text-muted">毎日のリマインドを最適なタイミングで受け取ります。</p>
        </div>

        <div className="settings-grid">
          <div className="field">
            <label className="field-label">日次進捗リマインド</label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={progressReminderEnabled}
                onChange={(e) => setProgressReminderEnabled(e.target.checked)}
              />
              <span>1日の終わりに進捗入力を促す通知を受け取る</span>
            </label>
            {progressReminderEnabled && (
              <div className="nested-field">
                <span className="field-label subtle">通知時刻</span>
                <input
                  id="progressReminderTime"
                  type="time"
                  value={progressReminderTime}
                  onChange={(e) => setProgressReminderTime(e.target.value)}
                />
              </div>
            )}
            <p className="hint">1日の終わりに、進捗入力を忘れないようお知らせします。</p>
          </div>

          <div className="field">
            <label className="field-label">朝プラン通知</label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={morningSummaryEnabled}
                onChange={(e) => setMorningSummaryEnabled(e.target.checked)}
              />
              <span>ホームの「今日のプラン」を通知で受け取る</span>
            </label>
            {morningSummaryEnabled && (
              <div className="nested-field">
                <span className="field-label subtle">通知時刻</span>
                <input
                  type="time"
                  value={morningSummaryTime}
                  onChange={(e) => setMorningSummaryTime(e.target.value)}
                />
              </div>
            )}
          </div>
        </div>

        <div className="settings-actions">
          <button className="btn-primary" onClick={saveNotificationSettings}>
            通知設定を保存
          </button>
        </div>
      </section>

      {/* アプリ設定 */}
      <section className="settings-card">
        <div className="section-title">
          <h3>アプリ設定</h3>
          <p className="text-muted">1日に割り当てるタスク量の目安を設定できます。</p>
        </div>
        <div className="settings-grid single-column">
          <div className="field">
            <label className="field-label" htmlFor="dailyCap">
              上限分数
            </label>
            <div className="inline-input">
              <input
                id="dailyCap"
                type="number"
                min="1"
                placeholder="未設定（120分）"
                value={dailyCap}
                onChange={(e) => setDailyCap(e.target.value)}
              />
              <span className="unit">分</span>
            </div>
            <p className="hint">未設定の場合はデフォルトで120分になります。</p>
          </div>
        </div>
        <div className="settings-actions">
          <button className="btn-primary" onClick={saveAppSettings}>
            アプリ設定を保存
          </button>
          {appMsg && (
            <p className={`save-feedback ${appMsg === "保存しました" ? "success" : "error"}`}>
              {appMsg}
            </p>
          )}
        </div>
      </section>

      {/* ラベル管理 */}
      <section className="settings-card labels-card">
        <div className="section-title">
          <h3>ラベル管理</h3>
          <p className="text-muted">タスクに色をつけて整理しましょう。</p>
        </div>

        <div className="label-form">
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
          <button className="btn-secondary" onClick={addLabel}>
            追加
          </button>
        </div>

        {labels.length === 0 ? (
          <p className="text-muted">ラベルはまだありません。</p>
        ) : (
          <ul className="label-list">
            {labels.map((lb) => (
              <li key={lb.id}>
                <span className="label-chip" style={{ "--label-color": lb.color }}>
                  <span className="label-dot" style={{ background: lb.color }} />
                  <span className="label-name">{lb.name}</span>
                </span>
                <button className="text-button" onClick={() => deleteLabel(lb.id)}>
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <VersionInfo />
    </div>
  );
}
