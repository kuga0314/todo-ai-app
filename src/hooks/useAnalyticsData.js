import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { buildDateRange, sanitizeLogs } from "../utils/analytics";

export function useAnalyticsData(userId, reloadSignal = 0) {
  const [loading, setLoading] = useState(true);
  const [noData, setNoData] = useState(false);
  const [todos, setTodos] = useState([]);
  const [labels, setLabels] = useState([]);
  const [dateRange, setDateRange] = useState([]);
  const [totalSeries, setTotalSeries] = useState([]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      setNoData(true);
      setTodos([]);
      setLabels([]);
      setDateRange([]);
      setTotalSeries([]);
      return;
    }

    setLoading(true);
    setNoData(false);

    let canceled = false;

    const todosQuery = query(collection(db, "todos"), where("userId", "==", userId));
    const labelsQuery = collection(db, "users", userId, "labels");

    const handleTodos = (snap) => {
      if (canceled) return;

      const fetchedTodos = [];
      const allDates = new Set();
      snap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        if (data.deleted === true) return;
        const actualLogs = sanitizeLogs(data.actualLogs);
        Object.keys(actualLogs).forEach((key) => allDates.add(key));
        fetchedTodos.push({
          id: docSnap.id,
          ...data,
          actualLogs,
        });
      });

      if (allDates.size === 0) {
        setTodos(fetchedTodos);
        setDateRange([]);
        setTotalSeries([]);
        setNoData(true);
        setLoading(false);
        return;
      }

      const sortedDates = Array.from(allDates).sort();
      const minKey = sortedDates[0];
      const maxActualKey = sortedDates[sortedDates.length - 1];
      const todayKey = new Date().toLocaleDateString("sv-SE", {
        timeZone: "Asia/Tokyo",
      });
      const maxKey = todayKey > maxActualKey ? todayKey : maxActualKey;
      const range = buildDateRange(minKey, maxKey);

      const totalsMap = new Map(range.map((key) => [key, 0]));
      fetchedTodos.forEach((todo) => {
        Object.entries(todo.actualLogs || {}).forEach(([key, value]) => {
          if (!totalsMap.has(key)) return;
          const minutes = Number(value);
          if (!Number.isFinite(minutes)) return;
          totalsMap.set(key, totalsMap.get(key) + minutes);
        });
      });

      setTodos(fetchedTodos);
      setDateRange(range);
      setTotalSeries(
        range.map((date) => ({
          date,
          minutes: totalsMap.get(date) || 0,
        }))
      );
      setNoData(false);
      setLoading(false);
    };

    const handleTodosError = (error) => {
      console.warn("Failed to load analytics todos", error);
      if (canceled) return;
      setTodos([]);
      setDateRange([]);
      setTotalSeries([]);
      setNoData(true);
      setLoading(false);
    };

    const handleLabels = (snap) => {
      if (canceled) return;
      const fetchedLabels = snap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() || {}),
      }));
      setLabels(fetchedLabels);
    };

    const handleLabelsError = (error) => {
      console.warn("Failed to load analytics labels", error);
      if (canceled) return;
      setLabels([]);
    };

    const unsubscribeTodos = onSnapshot(todosQuery, handleTodos, handleTodosError);
    const unsubscribeLabels = onSnapshot(labelsQuery, handleLabels, handleLabelsError);

    return () => {
      canceled = true;
      unsubscribeTodos?.();
      unsubscribeLabels?.();
    };
  }, [userId, reloadSignal]);

  return {
    loading,
    noData,
    todos,
    labels,
    dateRange,
    totalSeries,
  };
}
