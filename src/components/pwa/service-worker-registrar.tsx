"use client";

import { useEffect } from "react";

// Phase 1: registers a no-op service worker so the install prompt works on
// iOS / Android. Real offline behavior (caching, asset versioning, push)
// arrives in Phase 6 via Serwist.
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("SW registration failed:", err);
    });
  }, []);
  return null;
}
