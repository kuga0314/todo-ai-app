export function mapPlanItemsForDailyPlan(items = []) {
  return items.map((item, index) => {
    const required = Number.isFinite(Number(item.required))
      ? Math.round(Number(item.required))
      : null;

    return {
      todoId: item.id,
      title: item.text || "（無題）",
      plannedMinutes: Math.max(0, Math.round(Number(item.todayMinutes) || 0)),
      order: index + 1,
      requiredMinutes: required,
      labelColor: item.labelColor || null,
    };
  });
}

export function normalizePlanResult(result) {
  const items = (result?.items || []).map((item, index) => ({
    id: item.id,
    text: item.text || "（無題）",
    todayMinutes: Math.max(0, Math.round(Number(item.todayMinutes) || 0)),
    labelColor: item.labelColor || null,
    required: Number.isFinite(Number(item.required))
      ? Math.round(Number(item.required))
      : undefined,
    order: index + 1,
  }));

  const usedFromItems = Math.round(
    items.reduce((sum, item) => sum + (Number(item.todayMinutes) || 0), 0)
  );
  const used = Number.isFinite(Number(result?.used))
    ? Math.round(Number(result.used))
    : usedFromItems;

  return {
    cap: Number.isFinite(Number(result?.cap)) ? Math.round(Number(result.cap)) : null,
    used,
    items,
  };
}

export function normalizePlanDocument(data) {
  const items = (data?.items || []).map((item, index) => ({
    id: item.todoId,
    text: item.title || "（無題）",
    todayMinutes: Math.max(0, Math.round(Number(item.plannedMinutes) || 0)),
    labelColor: item.labelColor || null,
    order: Number.isFinite(Number(item.order)) ? Math.round(item.order) : index + 1,
  }));

  const used = Number.isFinite(Number(data?.totalPlannedMinutes))
    ? Math.round(Number(data.totalPlannedMinutes))
    : Math.round(items.reduce((sum, item) => sum + (Number(item.todayMinutes) || 0), 0));

  return {
    cap: Number.isFinite(Number(data?.capMinutes))
      ? Math.round(Number(data.capMinutes))
      : null,
    used,
    items,
  };
}

export function planSnapshotForHistory(plan) {
  if (!plan) return null;
  return {
    capMinutes: plan.cap,
    totalPlannedMinutes: plan.used,
    items: mapPlanItemsForDailyPlan(plan.items),
  };
}

export function removeUndefined(value) {
  if (Array.isArray(value)) {
    return value
      .map((v) => removeUndefined(v))
      .filter((v) => v !== undefined);
  }

  if (value && typeof value === "object" && value.constructor === Object) {
    return Object.entries(value).reduce((acc, [key, val]) => {
      const cleaned = removeUndefined(val);
      if (cleaned !== undefined) {
        acc[key] = cleaned;
      }
      return acc;
    }, {});
  }

  return value === undefined ? undefined : value;
}

export function arePlansEqual(a, b) {
  if (!a || !b) return false;
  if (Number(a.cap) !== Number(b.cap)) return false;
  if (Number(a.used) !== Number(b.used)) return false;
  const ai = a.items || [];
  const bi = b.items || [];
  if (ai.length !== bi.length) return false;
  for (let i = 0; i < ai.length; i++) {
    const x = ai[i];
    const y = bi[i];
    if (
      x.id !== y.id ||
      Number(x.todayMinutes) !== Number(y.todayMinutes) ||
      Number(x.order) !== Number(y.order)
    ) {
      return false;
    }
  }
  return true;
}
