import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, doc, getDoc, query, where } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { useAuth } from "../hooks/useAuth";

/** JSTのYYYY-MM-DD */
function todayKeyTokyo() {
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return f.format(new Date());
}

/** “遅れベース＋キャパ連動”で今日のプランを選定 */
function selectTodayPlan(todos, appSettings) {
  const capDefault = 120;
  const cap = Number.isFinite(Number(appSettings?.dailyCap))
    ? Number(appSettings.dailyCap)
    : capDefault;

  const today = new Date();

  // 候補抽出：遅れているタスク（actual < ideal）
  const candidates = [];
  for (const t of todos) {
    const E = Number(t.estimatedMinutes) || 0;
    const A = Number(t.actualTotalMinutes) || 0;
    if (E <= 0 || A >= E) continue;

    const R = Math.max(0, E - A);
    const required = Number(t.requiredPaceAdj ?? t.requiredPace ?? 0) || 0;

    // 期限・開始日時
    const deadline =
      t.deadline?.toDate?.() ??
      (t.deadline?.seconds ? new Date(t.deadline.seconds * 1000) : null);
    if (!deadline) continue;

    const createdAt =
      t.createdAt?.toDate?.() ??
      (t.createdAt?.seconds ? new Date(t.createdAt.seconds * 1000) : null) ??
      today;

    // 理想進捗 vs 実進捗
    const totalDays = Math.max(1, Math.ceil((deadline - createdAt) / 86400000));
    const elapsed = Math.max(0, Math.ceil((today - createdAt) / 86400000));
    const ideal = Math.min(1, elapsed / totalDays);
    const actual = Math.min(1, A / E);
    const lag = ideal - actual; // 正なら遅れ

    if (lag <= 0) continue;

    candidates.push({
      id: t.id,
      text: t.text || "（無題）",
      R,
      required,
      lag,
      deadlineTs: deadline.getTime(),
      labelColor: t.labelColor,
    });
  }

  // 並べ替え：遅れ度 → 必要ペース → 締切近さ
  candidates.sort(
    (a, b) =>
      b.lag - a.lag ||
      b.required - a.required ||
      a.deadlineTs - b.deadlineTs
  );

  // キャパで詰める（最大3件）
  let used = 0;
  const plan = [];
  for (const c of candidates) {
    const need = Math.min(Math.max(0, c.required), c.R, cap - used);
    if (need <= 0) continue;
    plan.push({ ...c, todayMinutes: Math.round(need) });
    used += need;
    if (used >= cap || plan.length >= 3) break;
  }

  // fallback：遅れ候補ゼロなら、締切＋必要ペースで上位3件
  if (plan.length === 0) {
    const pending = todos
      .map((t) => {
        const E = Number(t.estimatedMinutes) || 0;
        const A = Number(t.actualTotalMinutes) || 0;
        if (E <= 0 || A >= E) return null;
        const required = Number(t.requiredPaceAdj ?? t.requiredPace ?? 0) || 0;
        const deadline =
          t.deadline?.toDate?.() ??
          (t.deadline?.seconds ? new Date(t.deadline.seconds * 1000) : null);
        if (!deadline) return null;
        return {
          id: t.id,
          text: t.text || "（無題）",
          required,
          deadlineTs: deadline.getTime(),
          labelColor: t.labelColor,
        };
      })
      .filter(Boolean);
    pending.sort((a, b) => a.deadlineTs - b.deadlineTs || b.required - a.required);
    return { items: pending.slice(0, 3).map((x) => ({ ...x, todayMinutes: Math.round(x.required) })), cap, used: Math.round(pending.slice(0, 3).reduce((s, x) => s + x.required, 0)) };
  }

  return { items: plan, cap, used: Math.round(used) };
}

export default function DailyPlan() {
  const { user } = useAuth();
  const [todos, setTodos] = useState([]);
  const [appSettings, setAppSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  const dateKey = useMemo(() => todayKeyTokyo(), []);

  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      setLoading(true);
      // todos
      const snap = await getDocs(query(collection(db, "todos"), where("userId", "==", user.uid)));
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setTodos(list);

      // app settings（dailyCap 等）
      const appSnap = await getDoc(doc(db, `users/${user.uid}/settings/app`));
      setAppSettings(appSnap.exists() ? appSnap.data() : null);

      setLoading(false);
    })();
  }, [user?.uid]);

  const plan = useMemo(() => selectTodayPlan(todos, appSettings), [todos, appSettings]);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <h3 style={{ margin: 0 }}>今日のプラン</h3>
        <div style={{ fontSize: 12, opacity: 0.7 }}>{dateKey}</div>
      </div>

      <div className="card-content">
        {loading ? (
          <div>読み込み中…</div>
        ) : !plan.items || plan.items.length === 0 ? (
          <div>今日は予定された日次プランがありません。</div>
        ) : (
          <>
            <div style={{ marginBottom: 8 }}>
              合計 <b>{plan.used}</b> 分
              {Number.isFinite(plan.cap) && (
                <span style={{ marginLeft: 6, opacity: 0.7 }}>
                  （上限 {plan.cap} 分）
                </span>
              )}
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {plan.items.map((it, idx) => (
                <li key={it.id} style={{ display: "flex", alignItems: "center", padding: "6px 0", borderTop: idx===0 ? "none":"1px solid rgba(0,0,0,0.06)" }}>
                  {/* ラベル色の丸（あれば） */}
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: it.labelColor || "transparent",
                      display: "inline-block",
                      marginRight: 8,
                      border: "1px solid rgba(0,0,0,0.1)",
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {idx + 1}. {it.text}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      目安 {it.todayMinutes} 分
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
