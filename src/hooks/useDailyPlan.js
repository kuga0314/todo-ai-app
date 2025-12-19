import { useCallback, useEffect, useMemo, useState } from "react";
import { serverTimestamp } from "firebase/firestore";
import { getTodayKey } from "../utils/dailyPlan/todayKey";
import { selectTodayPlan } from "../utils/dailyPlan/selectTodayPlan";
import {
  arePlansEqual,
  mapPlanItemsForDailyPlan,
  normalizePlanDocument,
  normalizePlanResult,
  planSnapshotForHistory,
  removeUndefined,
} from "../utils/dailyPlan/normalize";
import {
  appendDailyPlanHistory,
  fetchAppSettings,
  fetchDailyPlan,
  fetchTodos,
  saveDailyPlan,
  updateTodoAssignments,
} from "../repositories/dailyPlanRepo";

export function useDailyPlan({ propTodos = [], propPlans = [], user, db }) {
  const [todos, setTodos] = useState(() =>
    (propTodos || []).filter((t) => t.deleted !== true)
  );
  const [appSettings, setAppSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [planLoaded, setPlanLoaded] = useState(false);
  const [planState, setPlanState] = useState(null);
  const [refreshMessage, setRefreshMessage] = useState("");
  const [revealWave, setRevealWave] = useState(0);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("dailyPlan.collapsed") === "true";
  });
  const todayKey = useMemo(() => getTodayKey(), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("dailyPlan.collapsed", collapsed ? "true" : "false");
  }, [collapsed]);

  useEffect(() => {
    if (!collapsed) {
      setRevealWave((v) => v + 1);
    }
  }, [collapsed]);

  useEffect(() => {
    const visible = (propTodos || []).filter((t) => t.deleted !== true);
    setTodos(visible);
  }, [propTodos]);

  useEffect(() => {
    if (!user?.uid) {
      setAppSettings(null);
      setLoading(false);
      setPlanLoaded(true);
      setPlanState(null);
      return;
    }

    let canceled = false;
    setLoading(true);

    (async () => {
      try {
        const settings = await fetchAppSettings({ db, uid: user.uid });
        if (!canceled) {
          setAppSettings(settings);
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    })();

    let planCanceled = false;
    setPlanLoaded(false);
    (async () => {
      try {
        const planData = await fetchDailyPlan({ db, uid: user.uid, todayKey });
        if (!planCanceled) {
          if (planData) {
            setPlanState(normalizePlanDocument(planData));
          } else {
            setPlanState(null);
          }
          setPlanLoaded(true);
        }
      } catch (error) {
        console.error("failed to load daily plan", error);
        if (!planCanceled) {
          setPlanState(null);
          setPlanLoaded(true);
        }
      }
    })();

    return () => {
      canceled = true;
      planCanceled = true;
    };
  }, [todayKey, user?.uid, db]);

  useEffect(() => {
    // consume propPlans to keep props aligned without altering behavior
  }, [propPlans]);

  const incompleteTodos = useMemo(
    () => (todos || []).filter((t) => !t.completed),
    [todos]
  );

  const initialPlanCandidate = useMemo(
    () => selectTodayPlan(incompleteTodos, appSettings, todayKey, { mode: "initial" }),
    [incompleteTodos, appSettings, todayKey]
  );

  const assignedPlan = useMemo(() => {
    const items = (todos || [])
      .filter((t) => t.deleted !== true && !t.completed)
      .map((t, index) => {
        const minutes = Number(t?.assigned?.[todayKey]) || 0;
        if (minutes <= 0) return null;
        return {
          id: t.id,
          text: t.text || "（無題）",
          todayMinutes: Math.round(minutes),
          labelColor: t.labelColor || null,
          order: index + 1,
        };
      })
      .filter(Boolean);

    if (items.length === 0) return null;

    const used = Math.round(
      items.reduce((sum, item) => sum + (Number(item.todayMinutes) || 0), 0)
    );

    return { items, used, cap: null };
  }, [todos, todayKey]);

  const visiblePlanState = useMemo(() => {
    if (!planState) return null;

    const visibleIds = new Set(
      (todos || [])
        .filter((t) => t.deleted !== true && !t.completed)
        .map((t) => t.id)
    );

    const filteredItems = (planState.items || []).filter((item) =>
      visibleIds.has(item.id)
    );

    if (filteredItems.length === (planState.items || []).length) {
      return planState;
    }

    const normalizedItems = filteredItems.map((item, index) => ({
      ...item,
      order: index + 1,
    }));

    const used = Math.round(
      normalizedItems.reduce(
        (sum, item) => sum + (Number(item.todayMinutes) || 0),
        0
      )
    );

    return { ...planState, items: normalizedItems, used };
  }, [planState, todos]);

  const activePlan = useMemo(
    () => visiblePlanState || assignedPlan || normalizePlanResult(initialPlanCandidate),
    [visiblePlanState, assignedPlan, initialPlanCandidate]
  );

  const planTodayMinutesMap = useMemo(() => {
    const map = new Map();
    (activePlan?.items || []).forEach((item) => {
      const minutes = Number(item.todayMinutes) || 0;
      if (minutes > 0) {
        map.set(item.id, Math.round(minutes));
      }
    });
    return map;
  }, [activePlan?.items]);

  const { chartData, totals: chartTotals } = useMemo(() => {
    const rows = (incompleteTodos || [])
      .map((t) => {
        const assigned = Number(t?.assigned?.[todayKey]) || 0;
        const fallbackAssigned = planTodayMinutesMap.get(t.id) || 0;
        const plannedMinutes = assigned > 0 ? assigned : fallbackAssigned;
        const actual = Number(t?.actualLogs?.[todayKey]) || 0;
        if (plannedMinutes <= 0 && actual <= 0) return null;
        return {
          id: t.id,
          name: t.text || "（無題）",
          planned: Math.round(plannedMinutes),
          actual: Math.round(actual),
        };
      })
      .filter(Boolean);

    const plannedTotal = Math.round(
      rows.reduce((sum, row) => sum + (Number(row.planned) || 0), 0)
    );
    const actualTotal = Math.round(
      rows.reduce((sum, row) => sum + (Number(row.actual) || 0), 0)
    );

    return {
      chartData: rows,
      totals: {
        planned: plannedTotal,
        actual: actualTotal,
        hasData: rows.length > 0,
      },
    };
  }, [incompleteTodos, todayKey, planTodayMinutesMap]);

  const chartDataWithSummary = useMemo(() => {
    if (!chartTotals.hasData) return [];
    return [
      ...chartData,
      {
        id: "__summary__",
        name: "合計",
        planned: chartTotals.planned,
        actual: chartTotals.actual,
        isSummary: true,
      },
    ];
  }, [chartData, chartTotals]);

  const buildPlanPayload = useCallback(
    (plan) => ({
      date: todayKey,
      userId: user.uid,
      capMinutes: Number.isFinite(Number(plan.cap))
        ? Math.round(Number(plan.cap))
        : null,
      totalPlannedMinutes: Math.max(0, Math.round(Number(plan.used) || 0)),
      items: mapPlanItemsForDailyPlan(plan.items || []),
      source: "dailyPlan-app",
      updatedAt: serverTimestamp(),
    }),
    [todayKey, user?.uid]
  );

  const persistPlan = useCallback(
    async (nextPlan, { previousPlan = null, todosForAssignments = incompleteTodos } = {}) => {
      if (!user?.uid) return;

      const payload = buildPlanPayload(nextPlan);
      const historyPayload = previousPlan
        ? {
            userId: user.uid,
            before: planSnapshotForHistory(previousPlan),
            after: planSnapshotForHistory(nextPlan),
            source: "dailyPlan-app",
            changedAt: serverTimestamp(),
          }
        : null;

      const safePayload = removeUndefined(payload);
      const safeHistory = historyPayload ? removeUndefined(historyPayload) : null;

      await saveDailyPlan({ db, uid: user.uid, todayKey, docData: safePayload });
      if (safeHistory) {
        await appendDailyPlanHistory({
          db,
          uid: user.uid,
          todayKey,
          historyData: safeHistory,
        });
      }

      await updateTodoAssignments({
        db,
        items: nextPlan.items,
        todayKey,
        todos: todosForAssignments,
      });

      setPlanState(nextPlan);
    },
    [user?.uid, buildPlanPayload, db, todayKey, incompleteTodos]
  );

  useEffect(() => {
    if (!user?.uid || !planLoaded) return;
    if (planState) return;
    if (!incompleteTodos || incompleteTodos.length === 0) return;

    const nextPlan = normalizePlanResult(initialPlanCandidate);
    setPlanState(nextPlan);

    (async () => {
      try {
        const payload = buildPlanPayload(nextPlan);
        const safePayload = removeUndefined(payload);
        await saveDailyPlan({ db, uid: user.uid, todayKey, docData: safePayload });
        await updateTodoAssignments({
          db,
          items: nextPlan.items,
          todayKey,
          todos: incompleteTodos,
        });
      } catch (error) {
        console.error("failed to initialize daily plan", error);
      }
    })();
  }, [
    user?.uid,
    planLoaded,
    planState,
    initialPlanCandidate,
    todayKey,
    incompleteTodos,
    buildPlanPayload,
    db,
  ]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  const handleRefreshPlan = useCallback(async () => {
    if (!user?.uid) return;
    const ok =
      typeof window !== "undefined"
        ? window.confirm("今日のプランを更新しますか？")
        : true;
    if (!ok) return;

    try {
      const freshTodos = (await fetchTodos({ db, uid: user.uid })).filter(
        (t) => t.deleted !== true
      );
      setTodos(freshTodos);

      const freshIncomplete = freshTodos.filter((t) => !t.completed);
      const nextPlan = normalizePlanResult(
        selectTodayPlan(freshIncomplete, appSettings, todayKey, {
          mode: "initial",
        })
      );

      if (visiblePlanState && arePlansEqual(visiblePlanState, nextPlan)) {
        setRefreshMessage(
          "進捗に変化がないため、提案内容に変更はありません。"
        );
        return;
      }

      await persistPlan(nextPlan, {
        previousPlan: visiblePlanState,
        todosForAssignments: freshIncomplete,
      });
      setRefreshMessage(
        "入力済みの進捗を反映して、今日のプランを再計算しました。"
      );
      setRevealWave((v) => v + 1);
    } catch (error) {
      console.error("refresh daily plan failed", error);
      const isPermissionError =
        error?.code === "permission-denied" ||
        /permission/i.test(error?.message || "");
      setRefreshMessage(
        isPermissionError
          ? "権限エラーのため今日のプランを保存できませんでした。再ログインするか、管理者に権限設定をご確認ください。"
          : "今日のプランの更新に失敗しました。時間をおいて再度お試しください。"
      );
    }
  }, [
    user?.uid,
    fetchTodos,
    db,
    appSettings,
    todayKey,
    visiblePlanState,
    persistPlan,
  ]);

  return {
    todayKey,
    loading,
    planLoaded,
    activePlan,
    refreshMessage,
    collapsed,
    toggleCollapsed,
    handleRefreshPlan,
    revealWave,
    chartData,
    chartTotals,
    chartDataWithSummary,
  };
}
