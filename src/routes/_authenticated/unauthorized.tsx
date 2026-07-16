import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const searchSchema = z.object({
  required: fallback(z.enum(["admin", "superAdmin"]).optional(), undefined),
});

export const Route = createFileRoute("/_authenticated/unauthorized")({
  validateSearch: zodValidator(searchSchema),
  component: UnauthorizedPage,
});

function UnauthorizedPage() {
  const { required } = Route.useSearch();
  const router = useRouter();

  const requirementLabel =
    required === "superAdmin"
      ? "Super admin access is required for that page."
      : required === "admin"
        ? "Agency or super admin access is required for that page."
        : "Your account does not have permission to view that page.";

  return (
    <div className="mx-auto max-w-lg py-12">
      <Card>
        <CardHeader className="items-center text-center">
          <div className="mx-auto inline-flex rounded-full bg-destructive/10 p-3 text-destructive">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <CardTitle className="mt-4">Access not authorized</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">{requirementLabel}</p>
          <p className="text-xs text-muted-foreground">
            If you believe this is a mistake, ask a super admin to review your role.
          </p>
          <div className="flex justify-center gap-2 pt-2">
            <Button variant="outline" onClick={() => router.history.back()}>Go back</Button>
            <Button asChild>
              <Link to="/dashboard">Go to dashboard</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}