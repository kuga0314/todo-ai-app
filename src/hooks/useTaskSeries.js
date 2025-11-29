import { useCallback, useState } from "react";
import { formatDateKey, parseDateKey } from "../utils/analytics";
import { addDays } from "date-fns";

export function useTaskSeries({ dateRange, refreshTick }) {
  const [seriesCache, setSeriesCacheState] = useState({});

  const toDateValue = (value) => {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value.toDate === "function") {
      const converted = value.toDate();
      return converted instanceof Date && !Number.isNaN(converted.getTime())
        ? converted
        : null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const buildTaskSeries = useCallback(
    (task) => {
      if (!dateRange.length) return [];
      const logs = task.actualLogs || {};

      const plannedStartAt = toDateValue(task.plannedStart);
      const plannedStartKey = plannedStartAt ? formatDateKey(plannedStartAt) : null;
      const logKeys = Object.keys(logs || {});
      const earliestLogKey = logKeys.length ? logKeys.reduce((a, b) => (a < b ? a : b)) : null;
      const startKey = plannedStartKey || earliestLogKey;

      const startIndex = startKey
        ? dateRange.findIndex((date) => date >= startKey)
        : 0;
      const effectiveRange =
        startIndex === -1 ? [] : dateRange.slice(Math.max(0, startIndex));
      if (!effectiveRange.length) return [];
      let cumulative = 0;
      const estimated = Number(task.estimatedMinutes) || 0;
      let deadline = null;
      const tickMarker = refreshTick;
      if (task.deadline?.toDate) {
        deadline = task.deadline.toDate();
      } else if (task.deadline instanceof Date) {
        deadline = task.deadline;
      } else if (typeof task.deadline === "string" || typeof task.deadline === "number") {
        const parsed = new Date(task.deadline);
        if (!Number.isNaN(parsed.getTime())) {
          deadline = parsed;
        }
      }

      const get7DayPace = (index) => {
        const startIdx = Math.max(0, index - 6);
        let sum = 0;
        let daysWorked = 0;
        for (let i = startIdx; i <= index; i += 1) {
          const key = effectiveRange[i];
          const value = Number(logs[key]) || 0;
          sum += value;
          if (value > 0) {
            daysWorked += 1;
          }
        }
        const denominator = Math.max(1, daysWorked < 3 ? daysWorked || 1 : 7);
        return sum / denominator;
      };

      return effectiveRange.map((date, index) => {
        const minutes = Number(logs[date]) || 0;
        const adjustedMinutes = minutes + tickMarker * 0;
        cumulative += adjustedMinutes;

        const remaining = Math.max(0, estimated - cumulative);
        const pace7 = get7DayPace(index);

        // Estimated completion timestamp based on recent pace.
        let eacTs = null;
        // EAC（完了予測日）
        if (pace7 > 0 && remaining > 0) {
          const currentDate = parseDateKey(date);
          if (!currentDate || isNaN(currentDate.getTime())) {
            eacTs = null;
          } else {
            const daysToFinish = remaining / pace7;

            // 不正値対策
            if (!isFinite(daysToFinish) || daysToFinish <= 0) {
              eacTs = null;
            } else {
              const eacDate = addDays(currentDate, Math.ceil(daysToFinish));
              eacTs = eacDate ? eacDate.getTime() : null;
            }
          }
        } else {
          eacTs = null;
        }

        let spi = null;
        if (deadline) {
          const currentDate = parseDateKey(date);
          const msLeft = currentDate ? deadline.getTime() - currentDate.getTime() : 0;
          const daysLeft = Math.max(1, Math.ceil(msLeft / 86400000));
          const required = remaining > 0 ? remaining / daysLeft : 0;
          if (required > 0) {
            const raw = pace7 / required;
            spi = Number.isFinite(raw) ? Number(raw.toFixed(2)) : null;
          } else {
            spi = remaining === 0 ? 1 : 0;
          }
        }

        return {
          date,
          minutes: adjustedMinutes,
          cum: cumulative,
          // Remaining estimated minutes to finish.
          remaining,
          // Recent 7-day pace used for SPI and EAC calculations.
          pace7,
          // Predicted completion date in ms since epoch based on remaining/pace.
          eacTs,
          spi,
        };
      });
    },
    [dateRange, refreshTick]
  );

  const setSeriesCache = useCallback((updater) => {
    setSeriesCacheState((prev) =>
      typeof updater === "function" ? updater(prev) : updater || {}
    );
  }, []);

  const ensureSeries = useCallback(
    (task) => {
      setSeriesCacheState((prev) => {
        if (prev[task.todo.id]) return prev;
        return {
          ...prev,
          [task.todo.id]: buildTaskSeries(task.todo),
        };
      });
    },
    [buildTaskSeries]
  );

  const invalidateSeries = useCallback((todoId) => {
    if (!todoId) return;
    setSeriesCacheState((prev) => {
      if (!prev[todoId]) return prev;
      const next = { ...prev };
      delete next[todoId];
      return next;
    });
  }, []);

  return { buildTaskSeries, ensureSeries, invalidateSeries, seriesCache, setSeriesCache };
}

export default useTaskSeries;
