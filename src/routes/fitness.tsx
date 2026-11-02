import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
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
    ],
  }),
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth", search: { redirect: "/fitness" } });
    const onboarding = location.pathname.startsWith("/fitness/onboarding");
    if (!onboarding) {
      const { data: profile } = await db
        .from("fitness_profiles")
        .select("onboarded_at")
        .maybeSingle();
      if (!profile?.onboarded_at) throw redirect({ to: "/fitness/onboarding" });
    }
    return { user: data.user };
  },
  component: Layout,
});

function Layout() {
  return (
    <PPShell>
      <Outlet />
    </PPShell>
  );
}
