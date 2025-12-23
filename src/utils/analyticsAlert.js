const STORAGE_KEY = "analyticsNeedsAttention";
export const ANALYTICS_ATTENTION_EVENT = "analytics:attention";

const hasWindow = () =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

export const readAnalyticsAttention = () => {
  if (!hasWindow()) return false;
  return window.localStorage.getItem(STORAGE_KEY) === "true";
};

export const writeAnalyticsAttention = (active) => {
  if (!hasWindow()) return;

  if (active) {
    window.localStorage.setItem(STORAGE_KEY, "true");
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }

  window.dispatchEvent(
    new CustomEvent(ANALYTICS_ATTENTION_EVENT, {
      detail: { active },
    })
  );
};

export const flagAnalyticsAttention = () => writeAnalyticsAttention(true);

export const clearAnalyticsAttention = () => writeAnalyticsAttention(false);

export const getAnalyticsAttentionKey = () => STORAGE_KEY;
