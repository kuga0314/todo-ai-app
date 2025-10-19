import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
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

    let active = true;
    const load = async () => {
      setLoading(true);
      setNoData(false);
      try {
        const todosQuery = query(collection(db, "todos"), where("userId", "==", userId));
        const labelsQuery = collection(db, "users", userId, "labels");

        const [todoSnap, labelSnap] = await Promise.all([
          getDocs(todosQuery),
          getDocs(labelsQuery),
        ]);

        if (!active) return;

        const fetchedLabels = labelSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() || {}),
        }));

        const fetchedTodos = [];
        const allDates = new Set();
        todoSnap.forEach((docSnap) => {
          const data = docSnap.data() || {};
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
          setLabels(fetchedLabels);
          setDateRange([]);
          setTotalSeries([]);
          setNoData(true);
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
        setLabels(fetchedLabels);
        setDateRange(range);
        setTotalSeries(
          range.map((date) => ({
            date,
            minutes: totalsMap.get(date) || 0,
          }))
        );
      } catch (error) {
        console.warn("Failed to load analytics data", error);
        if (!active) return;
        setTodos([]);
        setLabels([]);
        setDateRange([]);
        setTotalSeries([]);
        setNoData(true);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
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
