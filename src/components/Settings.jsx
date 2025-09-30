// src/components/Settings.jsx
import { useState, useEffect, useMemo } from "react";
import { db } from "../firebase/firebaseConfig";
import {
  doc, getDoc, setDoc,
  collection, addDoc, deleteDoc, onSnapshot
} from "firebase/firestore";
import { useAuth } from "../hooks/useAuth";
import "../styles/settings.css";

// Settings.jsx が src/components/ にある前提
import WorkHoursSection from "./settings/WorkHoursSection";

function Settings() {
  const { user } = useAuth();

  // 作業可能時間（目安の総量）
  const [weekday, setWeekday] = useState(2);
  const [weekend, setWeekend] = useState(4);

  // 実験設定（アルゴリズムは修正版PERTで固定）
  const [baselineAHours, setBaselineAHours] = useState(2); // 互換保持のみ（UIでは非表示）

  // 通知可能時間（平日/休日の送信ウィンドウ）
  const [weekdayStart, setWeekdayStart] = useState("08:00");
  const [weekdayEnd, setWeekdayEnd] = useState("23:00");
  const [weekendStart, setWeekendStart] = useState("09:00");
  const [weekendEnd, setWeekendEnd] = useState("23:30");

  // 通知モードと朝の通知時刻
  const [notificationMode, setNotificationMode] = useState("justInTime");
  const [morningTime, setMorningTime] = useState("08:00");

  // タスク入力時の既定値
  const [defaultDailyMinutes, setDefaultDailyMinutes] = useState("");

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  // ===== ラベル管理（追加：users/{uid}/labels をCRUD） =====
  const [labels, setLabels] = useState([]);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#ff9800"); // 既定: オレンジ
  const presetColors = [
    "#ff9800", // オレンジ（例：バイト）
    "#4caf50", // 緑（例：大学）
    "#2196f3", // 青
    "#e91e63", // ピンク
    "#9c27b0", // 紫
    "#795548", // ブラウン
    "#607d8b", // ブルーグレー
    "#9e9e9e", // グレー
  ];

  // 30分刻み候補
  const timeOptions = useMemo(() => (
    Array.from({ length: 48 }, (_, i) => {
      const h = String(Math.floor(i / 2)).padStart(2, "0");
      const m = i % 2 === 0 ? "00" : "30";
      return `${h}:${m}`;
    })
  ), []);

  // 初期設定の読み込み
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
        // 互換目的で baselineA_hours は保持（UIでは使わない）
        setBaselineAHours(
          Number.isFinite(data.baselineA_hours) ? data.baselineA_hours : 2
        );
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

      // notification（通知モードと朝の通知時刻）
      const notifRef = doc(db, "users", user.uid, "settings", "notification");
      const notifSnap = await getDoc(notifRef);
      if (notifSnap.exists()) {
        const data = notifSnap.data();
        setNotificationMode(
          data.mode === "morningSummary" ? "morningSummary" : "justInTime"
        );
        if (
          typeof data.morningTime === "string" &&
          timeOptions.includes(data.morningTime)
        ) {
          setMorningTime(data.morningTime);
        } else {
          setMorningTime("08:00");
        }
      }

      // defaults（入力時の既定値）
      const defaultsRef = doc(db, "users", user.uid, "settings", "defaults");
      const defaultsSnap = await getDoc(defaultsRef);
      if (defaultsSnap.exists()) {
        const data = defaultsSnap.data();
        if (
          typeof data.todoDailyMinutes === "number" &&
          Number.isFinite(data.todoDailyMinutes)
        ) {
          setDefaultDailyMinutes(String(data.todoDailyMinutes));
        } else {
          setDefaultDailyMinutes("");
        }
      }
    })();
  }, [user, timeOptions]);

  // ラベルの購読（リアルタイム）
  useEffect(() => {
    if (!user) return;
    const colRef = collection(db, "users", user.uid, "labels");
    const unsub = onSnapshot(colRef, (snap) => {
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...(d.data() ?? {}) }));
      setLabels(rows);
    });
    return () => unsub();
  }, [user]);

  const save = async () => {
    if (!user || saving) return;

    const defaultDailyValue =
      defaultDailyMinutes === ""
        ? null
        : Math.round(Number(defaultDailyMinutes));

    if (
      defaultDailyValue != null &&
      (!Number.isFinite(defaultDailyValue) || defaultDailyValue <= 0)
    ) {
      alert("1日あたり取り組む時間の既定値は正の数（分）で入力してください。");
      return;
    }

    if (
      notificationMode === "morningSummary" &&
      !timeOptions.includes(morningTime)
    ) {
      alert("朝の通知時刻を一覧から選択してください。");
      return;
    }

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
          baselineA_hours: Number(baselineAHours), // 互換保持
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
      await setDoc(
        doc(db, "users", user.uid, "settings", "notification"),
        {
          mode: notificationMode,
          morningTime: notificationMode === "morningSummary" ? morningTime : null,
        },
        { merge: true }
      );
      await setDoc(
        doc(db, "users", user.uid, "settings", "defaults"),
        { todoDailyMinutes: defaultDailyValue },
        { merge: true }
      );
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  };

  // ===== ラベルCRUD =====
  const handleAddLabel = async () => {
    if (!user) return;
    const name = newLabelName.trim();
    if (!name) return;
    try {
      await addDoc(collection(db, "users", user.uid, "labels"), {
        name,
        color: newLabelColor,
        createdAt: new Date(),
      });
      setNewLabelName("");
      // newLabelColorはそのままでもOK（同色連投想定）
    } catch (e) {
      console.error("add label failed:", e);
    }
  };

  const handleDeleteLabel = async (id) => {
    if (!user || !id) return;
    try {
      await deleteDoc(doc(db, "users", user.uid, "labels", id));
    } catch (e) {
      console.error("delete label failed:", e);
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

      {/* 通知モード切替 */}
      <section className="settings-card">
        <h3>通知モード</h3>
        <p className="hint">
          朝まとめ通知では、指定した時刻にその日の学習プランをまとめて受け取ります。
        </p>
        <div className="settings-grid">
          <label className="field field-radio">
            <input
              type="radio"
              name="notificationMode"
              value="justInTime"
              checked={notificationMode === "justInTime"}
              onChange={(e) => setNotificationMode(e.target.value)}
            />
            <span>直前リマインド（従来どおり）</span>
          </label>
          <label className="field field-radio">
            <input
              type="radio"
              name="notificationMode"
              value="morningSummary"
              checked={notificationMode === "morningSummary"}
              onChange={(e) => setNotificationMode(e.target.value)}
            />
            <span>朝まとめ通知（今日のプラン）</span>
          </label>
        </div>

        {notificationMode === "morningSummary" && (
          <div className="settings-grid">
            <label className="field">
              <span className="field-label">朝の通知時刻</span>
              <select
                value={morningTime}
                onChange={(e) => setMorningTime(e.target.value)}
              >
                {timeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <small className="hint">
                この時刻に当日の推奨タスクと割当時間をまとめて通知します。
              </small>
            </label>
          </div>
        )}
      </section>

      {/* タスク入力の既定値 */}
      <section className="settings-card">
        <h3>タスク入力の既定値</h3>
        <div className="settings-grid">
          <label className="field">
            <span className="field-label">1日あたり取り組む時間（分）</span>
            <input
              type="number"
              min={1}
              step={1}
              value={defaultDailyMinutes}
              onChange={(e) => setDefaultDailyMinutes(e.target.value)}
              placeholder="例: 60"
            />
            <small className="hint">
              タスク追加時の既定値として設定され、必要に応じて個別調整できます。
            </small>
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

      {/* ★ ラベル管理（新規追加セクション） */}
      <section className="settings-card">
        <h3>ラベル管理</h3>
        <p className="hint">カレンダー上のタスク色分けに使います（1タスク＝1ラベル）。</p>

        {/* 追加フォーム */}
        <div className="label-form">
          <label className="field">
            <span className="field-label">ラベル名</span>
            <input
              type="text"
              value={newLabelName}
              onChange={(e) => setNewLabelName(e.target.value)}
              placeholder="例）バイト / 大学 / 趣味 など"
            />
          </label>

          <div className="field">
            <span className="field-label">色</span>
            <div className="color-palette">
              {presetColors.map((col) => (
                <button
                  key={col}
                  type="button"
                  className={`color-swatch ${newLabelColor === col ? "selected" : ""}`}
                  style={{ backgroundColor: col }}
                  onClick={() => setNewLabelColor(col)}
                  aria-label={`色 ${col}`}
                  title={col}
                />
              ))}
              <input
                type="color"
                value={newLabelColor}
                onChange={(e) => setNewLabelColor(e.target.value)}
                className="color-picker"
                title="自由に色を選ぶ"
              />
            </div>
          </div>

          <div className="settings-actions">
            <button className="btn-primary" type="button" onClick={handleAddLabel} disabled={!newLabelName.trim()}>
              追加
            </button>
          </div>
        </div>

        {/* 一覧 */}
        <ul className="label-list">
          {labels.length === 0 && <li className="text-muted">ラベルはまだありません。</li>}
          {labels.map((lb) => (
            <li key={lb.id} className="label-item">
              <span className="label-color" style={{ backgroundColor: lb.color }} />
              <span className="label-name">{lb.name}</span>
              <button
                className="icon-btn"
                title="削除"
                aria-label="削除"
                onClick={() => handleDeleteLabel(lb.id)}
              >
                🗑️
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* ★ 作業可能“時間帯”セクション（逆算に使う勤務枠） */}
      <WorkHoursSection />
    </main>
  );
}

export default Settings;
