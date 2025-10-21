import { useEffect, useState } from "react";
import CHANGELOG from "../changelog";

const fallbackVersion =
  Array.isArray(CHANGELOG) && CHANGELOG.length > 0
    ? CHANGELOG[0]?.version || "dev"
    : "dev";

const createDefaultMeta = () => ({
  version: fallbackVersion,
  commit: "dev",
  branch: "dev",
  builtAt: new Date().toISOString(),
});

const buildMetaEndpoint = "/build-meta.json";

export default function useBuildMeta() {
  const [meta, setMeta] = useState(() => createDefaultMeta());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchMeta = async () => {
      try {
        const res = await fetch(buildMetaEndpoint, { cache: "no-store" });
        if (!res.ok) throw new Error("failed to fetch build meta");
        const data = await res.json();
        if (!cancelled && data) {
          setMeta({
            version: data.version || fallbackVersion,
            commit: data.commit || "dev",
            branch: data.branch || "dev",
            builtAt: data.builtAt || new Date().toISOString(),
          });
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("[build-meta] failed to load metadata", error);
          setMeta(createDefaultMeta());
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchMeta();

    return () => {
      cancelled = true;
    };
  }, []);

  return { meta, loading };
}

export { createDefaultMeta };
