import { useEffect, useState } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Package,
  Plug,
  ScrollText,
  Users,
  LogOut,
  Menu,
  PackagePlus,
  Store,
  FileUp,
  Tags,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMe, type MePayload } from "@/lib/me.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, admin: false },
  { to: "/products", label: "Products", icon: Package, admin: false },
  { to: "/products/new", label: "Add product", icon: PackagePlus, admin: false },
  { to: "/products/import", label: "Bulk import", icon: FileUp, admin: true },
  { to: "/integrations", label: "Integrations", icon: Plug, admin: true },
  { to: "/logs", label: "Logs", icon: ScrollText, admin: false },
  { to: "/admin/clients", label: "Clients", icon: Users, admin: true },
  { to: "/admin/categories", label: "Categories", icon: Tags, admin: true },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const fetchMe = useServerFn(getMe);
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });
  const me: MePayload | undefined = meQuery.data;

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => setMobileOpen(false), [pathname]);

  const handleSignOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const items = NAV.filter((item) => !item.admin || me?.isAdmin);

  const sidebar = (
    <aside className="flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-2 px-6 border-b border-sidebar-border">
        <div className="rounded-md bg-primary p-1.5 text-primary-foreground">
          <Store className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <div className="text-base font-semibold">StoreBridge</div>
          <div className="text-[11px] text-sidebar-foreground/60">Product Import Hub</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {items.map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-4">
        {meQuery.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-sidebar-foreground/60">Signed in as</div>
            <div className="text-sm font-medium truncate">{me?.fullName ?? me?.email}</div>
            <div className="text-[11px] uppercase tracking-wide text-primary">
              {me?.roles.join(", ") || "client"}
            </div>
            <Button variant="secondary" size="sm" className="w-full mt-2" onClick={handleSignOut}>
              <LogOut className="mr-2 h-3.5 w-3.5" /> Sign out
            </Button>
          </div>
        )}
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen w-full bg-background">
      <div className="hidden md:block sticky top-0 h-screen">{sidebar}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 h-full">{sidebar}</div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex h-14 items-center gap-2 border-b bg-card px-4 md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <div className="text-sm text-muted-foreground truncate">
            {NAV.find((n) => pathname === n.to || pathname.startsWith(n.to + "/"))?.label ?? "StoreBridge"}
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}