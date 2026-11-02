import { useEffect } from "react";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { PPShell } from "@/components/pp/shell";
import { db } from "@/lib/pp/db";

export const Route = createFileRoute("/fitness")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Prime Physique — Fitness Transformation" },
      {
        name: "description",
        content:
          "Track food to the gram, every set and rep, daily weight trends, measurements, photos, sleep and water.",
      },
      { name: "robots", content: "noindex" },
      { name: "theme-color", content: "#14161c" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Prime Physique" },
    ],
    links: [
      { rel: "manifest", href: "/pp-manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/pp-apple-touch-icon.png" },
    ],
  }),
  beforeLoad: async ({ location }) => {
    // Offline, single-user app: no login. Data lives on this device (IndexedDB).
    const onboarding = location.pathname.startsWith("/fitness/onboarding");
    if (!onboarding) {
      const { data: profile } = await db
        .from("fitness_profiles")
        .select("onboarded_at")
        .maybeSingle();
      if (!profile?.onboarded_at) throw redirect({ to: "/fitness/onboarding" });
    }
  },
  component: Layout,
});

/** Install the offline service worker and ask the browser to keep this device's data. */
function useOfflineSupport() {
  useEffect(() => {
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => undefined);
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/pp-sw.js", { scope: "/fitness" })
      .then(async (reg) => {
        await navigator.serviceWorker.ready;
        // Refresh the cached app files for the current deployment whenever we start online.
        if (navigator.onLine)
          (reg.active ?? reg.waiting ?? reg.installing)?.postMessage("pp-precache");
      })
      .catch((e) => console.warn("Prime Physique offline support unavailable:", e));
  }, []);
}

function Layout() {
  useOfflineSupport();
  return (
    <PPShell>
      <Outlet />
    </PPShell>
  );
}
