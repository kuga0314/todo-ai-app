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

const numberOr = (v, f) => (Number.isFinite(Number(v)) ? Number(v) : f);

export default function WorkHoursSection() {
  const { user } = useAuth();
  const [form, setForm] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

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

  const timeOrderValid = (() => {
    const [sh, sm] = (form.workStart || "00:00").split(":").map(Number);
    const [eh, em] = (form.workEnd || "00:00").split(":").map(Number);
    return eh * 60 + em > sh * 60 + sm; // 夜跨ぎは未対応
  })();

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
        通知はこの時間帯の<strong>み</strong>で締切から逆算されます（他の設定は保持）。
      </p>

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
