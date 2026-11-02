// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

/**
 * Emits /pp-precache.json: the list of client build files, so the Prime Physique service worker
 * (public/pp-sw.js) can cache every page's code up front and the app works fully offline.
 */
function primePhysiquePrecache(): Plugin {
  return {
    name: "prime-physique-precache",
    apply: "build",
    generateBundle(_options, bundle) {
      // Only the browser build; the SSR/worker builds don't serve these files.
      const env = (
        this as unknown as { environment?: { name?: string; config?: { consumer?: string } } }
      ).environment;
      if (
        env &&
        (env.config?.consumer ?? (env.name === "client" ? "client" : "server")) !== "client"
      )
        return;
      const files = Object.keys(bundle)
        .filter((f) => f.startsWith("assets/") && /\.(js|css|woff2?|png|svg|webp|jpg)$/.test(f))
        .map((f) => "/" + f)
        .sort();
      this.emitFile({ type: "asset", fileName: "pp-precache.json", source: JSON.stringify(files) });
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [primePhysiquePrecache()],
  },
});
