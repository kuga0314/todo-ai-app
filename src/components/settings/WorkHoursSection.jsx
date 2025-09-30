// src/components/settings/WorkHoursSection.jsx
import React, { useEffect, useMemo, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { useAuth } from "../../hooks/useAuth";

const DEFAULTS = {
  workStart: "10:00",
  workEnd: "23:00",
  skipWeekends: false,
  // 将来拡張してもここにデフォルトを書く。未指定は絶対に削らない（merge: true）
};

export default function WorkHoursSection() {
  const { user } = useAuth();
  const [form, setForm] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [capacity, setCapacity] = useState({ weekday: null, weekend: null });
  const [notificationMode, setNotificationMode] = useState("justInTime");

  const settingsDocRef = useMemo(() => {
    if (!user?.uid) return null;
    // 既存の settings ドキュメントをそのまま使用。merge:true なので他キーは維持されます
    return doc(db, "users", user.uid, "settings", "app");
  }, [user?.uid]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!settingsDocRef) return;
      try {
        const snap = await getDoc(settingsDocRef);
        if (!mounted) return;
        if (snap.exists()) {
          const data = snap.data();
          setForm({
            workStart: data.workStart || DEFAULTS.workStart,
            workEnd: data.workEnd || DEFAULTS.workEnd,
            skipWeekends:
              typeof data.skipWeekends === "boolean"
                ? data.skipWeekends
                : DEFAULTS.skipWeekends,
          });
        } else {
          setForm(DEFAULTS);
        }
      } catch (e) {
        console.error(e);
        setMsg("作業時間の読み込みに失敗しました。");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [settingsDocRef]);

  useEffect(() => {
    if (!user?.uid) return undefined;
    let active = true;
    (async () => {
      try {
        const capRef = doc(db, "users", user.uid, "settings", "capacity");
        const capSnap = await getDoc(capRef);
        if (active && capSnap.exists()) {
          const data = capSnap.data() || {};
          setCapacity({
            weekday: Number.isFinite(Number(data.weekday)) ? Number(data.weekday) : null,
            weekend: Number.isFinite(Number(data.weekend)) ? Number(data.weekend) : null,
          });
        }

        const notifRef = doc(db, "users", user.uid, "settings", "notification");
        const notifSnap = await getDoc(notifRef);
        if (active && notifSnap.exists()) {
          const data = notifSnap.data() || {};
          setNotificationMode(
            data.mode === "morningSummary" ? "morningSummary" : "justInTime"
          );
        }
      } catch (error) {
        console.warn("work hours side data load failed", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [user?.uid]);

  const timeOrderValid = (() => {
    const [sh, sm] = (form.workStart || "00:00").split(":").map(Number);
    const [eh, em] = (form.workEnd || "00:00").split(":").map(Number);
    return eh * 60 + em > sh * 60 + sm; // 夜跨ぎは未対応
  })();

  const weekendCapacity =
    capacity.weekend != null && Number.isFinite(capacity.weekend)
      ? capacity.weekend
      : null;
  const weekdayCapacity =
    capacity.weekday != null && Number.isFinite(capacity.weekday)
      ? capacity.weekday
      : null;
  const weekendMismatch = form.skipWeekends && weekendCapacity && weekendCapacity > 0;
  const weekendZeroButIncluded =
    !form.skipWeekends && weekendCapacity != null && weekendCapacity <= 0;

  const handleSave = async () => {
    if (!settingsDocRef) return;
    setMsg("");
    if (!timeOrderValid) {
      setMsg("作業可能時間は「開始 < 終了」にしてください（夜跨ぎ未対応）。");
      return;
    }
    setSaving(true);
    try {
      // ーーー超重要ーーー
      // merge: true で書くため、既存の他キー（アルゴリズム設定など）は一切消えません。
      await setDoc(
        settingsDocRef,
        {
          workStart: form.workStart,
          workEnd: form.workEnd,
          skipWeekends: !!form.skipWeekends,
          updatedAt: new Date(),
        },
        { merge: true }
      );
      setMsg("作業可能時間を保存しました。");
    } catch (e) {
      console.error(e);
      setMsg("保存に失敗しました。通信環境を確認してください。");
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;
  if (loading) {
    return (
      <section className="mb-8 p-4 rounded-xl border">
        <h2 className="font-semibold mb-2">一日に可能な作業時間</h2>
        <p>読み込み中…</p>
      </section>
    );
  }

  return (
    <section className="mb-8 p-4 rounded-xl border">
      <h2 className="font-semibold mb-4">一日に可能な作業時間</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div>
          <label className="block text-sm mb-1">開始時刻</label>
          <input
            type="time"
            value={form.workStart}
            onChange={(e) =>
              setForm((p) => ({ ...p, workStart: e.target.value }))
            }
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm mb-1">終了時刻</label>
          <input
            type="time"
            value={form.workEnd}
            onChange={(e) =>
              setForm((p) => ({ ...p, workEnd: e.target.value }))
            }
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>
        <div className="flex items-center h-11 mt-6 md:mt-0">
          <input
            id="skipWeekends"
            type="checkbox"
            checked={!!form.skipWeekends}
            onChange={(e) =>
              setForm((p) => ({ ...p, skipWeekends: e.target.checked }))
            }
            className="mr-2"
          />
          <label htmlFor="skipWeekends" className="select-none">
            土日を作業対象から除外する
          </label>
        </div>
      </div>
      {!timeOrderValid && (
        <p className="text-red-600 text-sm mt-2">
          ※ 夜またぎは未対応のため、終了は開始より後の時刻にしてください。
        </p>
      )}
      <p className="text-sm text-gray-600 mt-3">
        {notificationMode === "morningSummary"
          ? "朝まとめ通知モードでは、ここで設定した時間帯が日次プランの作業枠や朝のサマリー本文に利用されます。"
          : "通知はこの時間帯のみに送信されます（従来の直前リマインドモード）。"}
      </p>
      <div
        className="text-sm text-gray-600 mt-2"
        style={{ display: "grid", gap: "0.25rem" }}
      >
        <p>
          平日キャパシティ: {weekdayCapacity != null ? `${weekdayCapacity}時間/日` : "未設定"} ／
          休日キャパシティ: {weekendCapacity != null ? `${weekendCapacity}時間/日` : "未設定"}
        </p>
        <p>
          {form.skipWeekends
            ? "土日は日次プランから除外されます。"
            : "土日も計画対象に含めます。"}
        </p>
        {weekendMismatch && (
          <p style={{ color: "#dc2626" }}>
            ※ 土日除外に設定されていますが、休日キャパシティが {weekendCapacity} 時間のままです。必要に応じて「作業可能時間」で休日を 0 時間に設定してください。
          </p>
        )}
        {weekendZeroButIncluded && (
          <p style={{ color: "#d97706" }}>
            ※ 休日キャパシティが 0 時間のため、週末にも取り組みたい場合は「土日を除外する」をオンにするか、休日キャパシティを見直してください。
          </p>
        )}
      </div>

      <div className="mt-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? "保存中…" : "保存"}
        </button>
        {msg && <span className="ml-3 text-sm text-gray-700">{msg}</span>}
      </div>
    </section>
  );
}
