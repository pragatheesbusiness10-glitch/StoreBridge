import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Status = "draft" | "submitted" | "approved" | "published" | "failed" | "rejected";

const styles: Record<Status, string> = {
  draft: "bg-muted text-muted-foreground border-transparent",
  submitted: "bg-sky-100 text-sky-800 border-transparent",
  approved: "bg-amber-100 text-amber-800 border-transparent",
  published: "bg-emerald-100 text-emerald-800 border-transparent",
  failed: "bg-red-100 text-red-800 border-transparent",
  rejected: "bg-rose-100 text-rose-800 border-transparent",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge className={cn("capitalize font-medium", styles[status])}>
      {status.replace("_", " ")}
    </Badge>
  );
}