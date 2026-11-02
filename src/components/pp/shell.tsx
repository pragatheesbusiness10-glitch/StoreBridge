import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  BookOpen,
  CalendarCheck,
  Camera,
  ClipboardList,
  Droplet,
  Dumbbell,
  Footprints,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  Ruler,
  Salad,
  Scale,
  Settings,
  Sun,
  Utensils,
  X,
  Zap,
  Beef,
  ListPlus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { todayStr } from "@/lib/pp/dates";
import { db, errMsg } from "@/lib/pp/db";
import type { WorkoutSession } from "@/lib/pp/types";
import { cn } from "@/lib/utils";
import { FoodLogDialog } from "./food-log-dialog";
import { WaterQuickAdd } from "./water-quick";
import { WeightDialog } from "./weight-dialog";

const NAV = [
  { to: "/fitness", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/fitness/daily", label: "Daily Log", icon: CalendarCheck },
  { to: "/fitness/weight", label: "Daily Weight", icon: Scale },
  { to: "/fitness/nutrition", label: "Nutrition", icon: Utensils },
  { to: "/fitness/foods", label: "Food Database", icon: Salad },
  { to: "/fitness/planner", label: "Workout Planner", icon: ClipboardList },
  { to: "/fitness/exercises", label: "Exercise Library", icon: BookOpen },
  { to: "/fitness/workouts", label: "Workout History", icon: History },
  { to: "/fitness/measurements", label: "Body Measurements", icon: Ruler },
  { to: "/fitness/photos", label: "Progress Photos", icon: Camera },
  { to: "/fitness/cardio", label: "Cardio & Steps", icon: Footprints },
  { to: "/fitness/sleep-water", label: "Sleep & Water", icon: Moon },
  { to: "/fitness/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/fitness/settings", label: "Settings", icon: Settings },
] as const;

const BOTTOM = [
  { to: "/fitness", label: "Home", icon: LayoutDashboard, exact: true },
  { to: "/fitness/nutrition", label: "Food", icon: Utensils },
  { to: "/fitness/workouts", label: "Train", icon: Dumbbell },
  { to: "/fitness/daily", label: "Today", icon: CalendarCheck },
] as const;

type QuickCtx = {
  openWeight: (date?: string) => void;
  openFood: (opts?: { date?: string; category?: string }) => void;
  openQuick: () => void;
  startOrResumeWorkout: () => Promise<void>;
};
const QuickContext = createContext<QuickCtx | null>(null);
export const useQuick = () => {
  const c = useContext(QuickContext);
  if (!c) throw new Error("useQuick outside PPShell");
  return c;
};

const THEME_KEY = "pp-theme";

export function PPShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [weightOpen, setWeightOpen] = useState(false);
  const [weightDate, setWeightDate] = useState<string | undefined>();
  const [foodOpen, setFoodOpen] = useState(false);
  const [foodOpts, setFoodOpts] = useState<{ date?: string; category?: string }>({});
  const [dark, setDark] = useState(true);

  // Theme: Prime Physique defaults to dark; scoped to <html> while this module is mounted.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch {
      /* storage unavailable */
    }
    setDark(saved ? saved === "dark" : true);
  }, []);
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("pp");
    html.classList.toggle("dark", dark);
    return () => {
      html.classList.remove("pp", "dark");
    };
  }, [dark]);
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  };

  useEffect(() => setMobileOpen(false), [pathname]);

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { redirect: "/fitness" }, replace: true });
  };

  const startOrResumeWorkout = async () => {
    try {
      const { data } = await db
        .from("workout_sessions")
        .select("id")
        .eq("status", "in_progress")
        .order("session_date", { ascending: false })
        .limit(1);
      const active = (data as Pick<WorkoutSession, "id">[] | null)?.[0];
      if (active) navigate({ to: "/fitness/workouts/$id", params: { id: active.id } });
      else navigate({ to: "/fitness/workouts", search: { start: "today" } });
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const ctx: QuickCtx = {
    openWeight: (date) => {
      setWeightDate(date);
      setWeightOpen(true);
    },
    openFood: (opts = {}) => {
      setFoodOpts(opts);
      setFoodOpen(true);
    },
    openQuick: () => setQuickOpen(true),
    startOrResumeWorkout,
  };

  const isActive = (to: string, exact?: boolean) =>
    exact
      ? pathname === to || pathname === to + "/"
      : pathname === to || pathname.startsWith(to + "/");

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-5">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Zap className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <div className="text-base font-bold tracking-tight">PRIME PHYSIQUE</div>
          <div className="text-[11px] text-sidebar-foreground/60">Transformation OS</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              isActive(item.to, "exact" in item ? item.exact : false)
                ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="space-y-2 border-t border-sidebar-border p-3">
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={toggleTheme}>
          {dark ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
          {dark ? "Light mode" : "Dark mode"}
        </Button>
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={signOut}>
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </Button>
      </div>
    </aside>
  );

  const quickActions = [
    { label: "Log Weight", icon: Scale, run: () => ctx.openWeight() },
    { label: "Add Food", icon: Utensils, run: () => ctx.openFood() },
    { label: "Log Protein", icon: Beef, run: () => ctx.openFood({ category: "protein" }) },
    {
      label: "Add Workout",
      icon: Dumbbell,
      run: () => navigate({ to: "/fitness/workouts", search: { start: "today" } }),
    },
    { label: "Record Exercise Set", icon: ListPlus, run: () => startOrResumeWorkout() },
    {
      label: "Log Measurements",
      icon: Ruler,
      run: () => navigate({ to: "/fitness/measurements", search: { new: 1 } }),
    },
    {
      label: "Upload Progress Photo",
      icon: Camera,
      run: () => navigate({ to: "/fitness/photos", search: { upload: 1 } }),
    },
    {
      label: "Log Cardio / Steps",
      icon: Activity,
      run: () => navigate({ to: "/fitness/cardio", search: { new: 1 } }),
    },
  ];

  const current = NAV.find((n) => isActive(n.to, "exact" in n ? n.exact : false));

  return (
    <QuickContext.Provider value={ctx}>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <div className="sticky top-0 hidden h-screen md:block pp-no-print">{sidebar}</div>
        {mobileOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
            <div className="absolute inset-y-0 left-0 h-full">{sidebar}</div>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-3 top-3 text-white"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur md:px-6 pp-no-print">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2 md:hidden">
              <Zap className="h-4 w-4 text-primary" />
              <span className="text-sm font-bold tracking-tight">PRIME PHYSIQUE</span>
            </div>
            <div className="hidden text-sm text-muted-foreground md:block">{current?.label}</div>
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={toggleTheme}
                aria-label="Toggle theme"
              >
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button
                size="sm"
                className="hidden md:inline-flex"
                onClick={() => setQuickOpen(true)}
              >
                <Plus className="mr-1 h-4 w-4" /> Quick add
              </Button>
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 p-3 pb-28 md:p-6 md:pb-10">
            {children}
          </main>
        </div>

        {/* Mobile bottom navigation with centre quick-add */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden pp-no-print">
          {BOTTOM.slice(0, 2).map((b) => (
            <Link
              key={b.to}
              to={b.to}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 text-[10px]",
                isActive(b.to, "exact" in b ? b.exact : false)
                  ? "text-primary"
                  : "text-muted-foreground",
              )}
            >
              <b.icon className="h-5 w-5" />
              {b.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setQuickOpen(true)}
            className="flex flex-col items-center justify-center"
            aria-label="Quick add"
          >
            <span className="-mt-5 grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background">
              <Plus className="h-6 w-6" />
            </span>
          </button>
          {BOTTOM.slice(2).map((b) => (
            <Link
              key={b.to}
              to={b.to}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 text-[10px]",
                isActive(b.to, "exact" in b ? b.exact : false)
                  ? "text-primary"
                  : "text-muted-foreground",
              )}
            >
              <b.icon className="h-5 w-5" />
              {b.label}
            </Link>
          ))}
        </nav>

        <Sheet open={quickOpen} onOpenChange={setQuickOpen}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
            <SheetHeader>
              <SheetTitle>Quick add</SheetTitle>
            </SheetHeader>
            <div className="grid grid-cols-2 gap-2 px-4 sm:grid-cols-4">
              {quickActions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => {
                    setQuickOpen(false);
                    a.run();
                  }}
                  className="flex flex-col items-center gap-2 rounded-xl border bg-card p-4 text-sm font-medium hover:border-primary hover:bg-accent"
                >
                  <a.icon className="h-6 w-6 text-primary" />
                  {a.label}
                </button>
              ))}
            </div>
            <div className="px-4 pb-6 pt-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Droplet className="h-4 w-4 text-sky-500" /> Add water (today)
              </div>
              <WaterQuickAdd date={todayStr()} />
            </div>
          </SheetContent>
        </Sheet>

        <WeightDialog open={weightOpen} onOpenChange={setWeightOpen} date={weightDate} />
        <FoodLogDialog
          open={foodOpen}
          onOpenChange={setFoodOpen}
          date={foodOpts.date ?? todayStr()}
          categoryFilter={foodOpts.category}
        />
      </div>
    </QuickContext.Provider>
  );
}
