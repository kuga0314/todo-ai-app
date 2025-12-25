import { createContext, useContext, useEffect, useMemo, useState } from "react";

const DEFAULT_THEME_ID = "emerald";

export const THEME_OPTIONS = [
  { id: "emerald", label: "エメラルド" },
  { id: "blue", label: "ブルー" },
  { id: "teal", label: "ティール" },
  { id: "purple", label: "パープル" },
  { id: "orange", label: "オレンジ" },
  { id: "pink", label: "ピンク" },
];

const ThemeContext = createContext({
  themeId: DEFAULT_THEME_ID,
  setThemeId: () => {},
  options: THEME_OPTIONS,
});

const storageKey = "app-theme";

const applyThemeToDocument = (themeId) => {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = themeId;
};

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(() => {
    const stored =
      typeof localStorage !== "undefined" ? localStorage.getItem(storageKey) : null;
    const initial = stored || DEFAULT_THEME_ID;
    applyThemeToDocument(initial);
    return initial;
  });

  useEffect(() => {
    applyThemeToDocument(themeId);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(storageKey, themeId);
    }
  }, [themeId]);

  const value = useMemo(
    () => ({ themeId, setThemeId, options: THEME_OPTIONS }),
    [themeId]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
