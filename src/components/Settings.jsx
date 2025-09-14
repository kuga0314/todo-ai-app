// src/components/Settings.jsx
import { useState, useEffect } from "react";
import { db } from "../firebase/firebaseConfig";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useAuth } from "../hooks/useAuth";
import "../styles/settings.css";

// Settings.jsx が src/components/ にある前提（←あなたの現状）
// 後で Settings.jsx を src/pages/ に移す場合は、下を
//   import WorkHoursSection from "../components/settings/WorkHoursSection";
// に変更してください。
import WorkHoursSection from "./settings/WorkHoursSection";

function Settings() {
  const { user } = useAuth();

  // 作業可能時間（目安の総量）
  const [weekday, setWeekday] = useState(2);
  const [weekend, setWeekend] = useState(4);

  // 実験設定（アルゴリズムは修正版PERTで固定）
  const [algoVariant, setAlgoVariant] = useState("modifiedPERT");
  const [baselineAHours, setBaselineAHours] = useState(2); // 互換保持のみ（UIでは非表示）

  // 通知可能時間（平日/休日の送信ウィンドウ）
  const [weekdayStart, setWeekdayStart] = useState("08:00");
  const [weekdayEnd, setWeekdayEnd] = useState("23:00");
  const [weekendStart, setWeekendStart] = useState("09:00");
  const [weekendEnd, setWeekendEnd] = useState("23:30");

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  // 30分刻み候補
  const timeOptions = Array.from({ length: 48 }, (_, i) => {
    const h = String(Math.floor(i / 2)).padStart(2, "0");
    const m = i % 2 === 0 ? "00" : "30";
    return `${h}:${m}`;
  });

  useEffect(() => {
    if (!user) return;
    (async () => {
      // capacity（1日の目安作業時間・平日/休日）
      const capRef = doc(db, "users", user.uid, "settings", "capacity");
      const capSnap = await getDoc(capRef);
      if (capSnap.exists()) {
        const data = capSnap.data();
        setWeekday(data.weekday ?? 2);
        setWeekend(data.weekend ?? 4);
      }

      // experiment（アルゴリズム切替＋パラメータ）
      const expRef = doc(db, "users", user.uid, "settings", "experiment");
      const expSnap = await getDoc(expRef);
      if (expSnap.exists()) {
        const data = expSnap.data();
        // 読み込み時点では何が入っていても UI/状態は modifiedPERT に矯正
        setAlgoVariant("modifiedPERT");
        // 互換目的で baselineA_hours は保持（UIでは使わない）
        setBaselineAHours(
          Number.isFinite(data.baselineA_hours) ? data.baselineA_hours : 2
        );
      } else {
        // ドキュメント未作成でも状態は modifiedPERT を維持
        setAlgoVariant("modifiedPERT");
      }

      // notifyWindow（通知を送ってよい時間帯）
      const winRef = doc(db, "users", user.uid, "settings", "notifyWindow");
      const winSnap = await getDoc(winRef);
      if (winSnap.exists()) {
        const data = winSnap.data();
        setWeekdayStart(data.weekday?.start ?? "08:00");
        setWeekdayEnd(data.weekday?.end ?? "23:00");
        setWeekendStart(data.weekend?.start ?? "09:00");
        setWeekendEnd(data.weekend?.end ?? "23:30");
      }
    })();
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await setDoc(
        doc(db, "users", user.uid, "settings", "capacity"),
        { weekday: +weekday, weekend: +weekend },
        { merge: true }
      );
      // アルゴリズムは常に修正版PERTで固定して保存
      await setDoc(
        doc(db, "users", user.uid, "settings", "experiment"),
        {
          algoVariant: "modifiedPERT",
          // 互換保持：将来削除可（ここでは値を維持）
          baselineA_hours: Number(baselineAHours),
        },
        { merge: true }
      );
      await setDoc(
        doc(db, "users", user.uid, "settings", "notifyWindow"),
        {
          weekday: { start: weekdayStart, end: weekdayEnd },
          weekend: { start: weekendStart, end: weekendEnd },
        },
        { merge: true }
      );
      setSavedAt(new Date());
      // 状態も安全のため固定化
      setAlgoVariant("modifiedPERT");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="settings-container">
      <section className="settings-header">
        <h2>設定</h2>
        <p className="text-muted">作業時間・通知時間・実験用アルゴリズムを管理します。</p>
      </section>

      {/* 作業可能時間（総量の目安） */}
      <section className="settings-card">
        <h3>作業可能時間</h3>
        <div className="settings-grid">
          <label className="field">
            <span className="field-label">平日（h）</span>
            <input
              type="number"
              min={0}
              max={24}
              step={0.5}
              value={weekday}
              onChange={(e) => setWeekday(e.target.value)}
            />
            <small className="hint">1日に確保できる目安時間</small>
          </label>

          <label className="field">
            <span className="field-label">休日（h）</span>
            <input
              type="number"
              min={0}
              max={24}
              step={0.5}
              value={weekend}
              onChange={(e) => setWeekend(e.target.value)}
            />
            <small className="hint">休日に確保できる目安時間</small>
          </label>
        </div>
      </section>

      {/* 通知可能時間ウィンドウ */}
      <section className="settings-card">
        <h3>通知可能時間</h3>
        <div className="settings-grid">
          <label className="field">
            <span className="field-label">平日：開始</span>
            <select value={weekdayStart} onChange={(e) => setWeekdayStart(e.target.value)}>
              {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">平日：終了</span>
            <select value={weekdayEnd} onChange={(e) => setWeekdayEnd(e.target.value)}>
              {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">休日：開始</span>
            <select value={weekendStart} onChange={(e) => setWeekendStart(e.target.value)}>
              {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">休日：終了</span>
            <select value={weekendEnd} onChange={(e) => setWeekendEnd(e.target.value)}>
              {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>
      </section>

      {/* 実験設定（アルゴリズムは固定） */}
      <section className="settings-card">
        <h3>実験設定（通知アルゴリズム）</h3>
        <div className="settings-grid">
          <label className="field">
            <span className="field-label">方式</span>
            <div>修正版PERT（固定）</div>
            <small className="hint">研究用の切替は停止中。評価は修正版PERTで統一します。</small>
          </label>
        </div>

        <div className="settings-actions">
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </button>
          {savedAt && (
            <span className="save-feedback">
              保存しました（{savedAt.toLocaleTimeString()}）
            </span>
          )}
        </div>
      </section>

      {/* ★ 作業可能“時間帯”セクション（逆算に使う勤務枠） */}
      <WorkHoursSection />
    </main>
  );
}

export default Settings;
