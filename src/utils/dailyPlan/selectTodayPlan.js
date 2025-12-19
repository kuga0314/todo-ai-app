/** “遅れベース＋キャパ連動”で今日のプランを選定 */
export function selectTodayPlan(todos, appSettings, _todayKey, options = {}) {
  const { mode = "initial", remainingCap = null } = options;
  const capDefault = 120;
  const baseCap = Number.isFinite(Number(appSettings?.dailyCap))
    ? Number(appSettings.dailyCap)
    : capDefault;

  let cap;
  if (mode === "initial") {
    cap = baseCap;
  } else {
    if (typeof remainingCap === "number" && remainingCap > 0) {
      cap = remainingCap;
    } else {
      cap = Infinity;
    }
  }

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
    let need;

    const required = Math.max(0, c.required);
    const R = c.R;

    if (cap === Infinity) {
      need = Math.min(required, R);
    } else {
      const remainCapForThisTask = Math.max(0, cap - used);
      need = Math.min(required, R, remainCapForThisTask);
    }
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
    return {
      items: pending
        .slice(0, 3)
        .map((x) => ({ ...x, todayMinutes: Math.round(x.required) })),
      cap,
      used: Math.round(
        pending.slice(0, 3).reduce((s, x) => s + x.required, 0)
      ),
    };
  }

  return { items: plan, cap, used: Math.round(used) };
}
