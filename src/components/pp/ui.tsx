import { useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Provenance of a number: Prime Physique always labels where a value came from. */
export type DataKind = "measured" | "entered" | "calculated" | "estimated" | "planned";
const KIND_STYLE: Record<DataKind, { label: string; cls: string; tip: string }> = {
  measured: {
    label: "Measured",
    cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
    tip: "Recorded by a measurement (scale, tape, device).",
  },
  entered: {
    label: "Entered",
    cls: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
    tip: "Typed in by you.",
  },
  calculated: {
    label: "Calculated",
    cls: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
    tip: "Derived by formula from your stored records.",
  },
  estimated: {
    label: "Estimate",
    cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    tip: "An estimate — not a measurement.",
  },
  planned: {
    label: "Planned",
    cls: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
    tip: "A target or projection, not actual data.",
  },
};

export function KindBadge({ kind, className }: { kind: DataKind; className?: string }) {
  const k = KIND_STYLE[kind];
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              k.cls,
              className,
            )}
          >
            {k.label}
          </span>
        </TooltipTrigger>
        <TooltipContent>{k.tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 pp-no-print">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
  description,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border bg-card p-4 shadow-sm", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  unit,
  sub,
  kind,
  progress,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  kind?: DataKind;
  progress?: number | null;
  tone?: "good" | "warn" | "bad";
  className?: string;
}) {
  const empty = value === null || value === undefined || value === "—";
  return (
    <div className={cn("rounded-xl border bg-card p-3 shadow-sm", className)}>
      <div className="flex items-center justify-between gap-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground truncate">
          {label}
        </div>
        {kind && !empty && <KindBadge kind={kind} />}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={cn(
            "text-xl font-semibold tabular-nums",
            empty && "text-muted-foreground",
            tone === "good" && "text-[var(--pp-good)]",
            tone === "warn" && "text-[var(--pp-warn)]",
            tone === "bad" && "text-destructive",
          )}
        >
          {empty ? "—" : value}
        </span>
        {unit && !empty && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      {progress !== undefined && progress !== null && (
        <Progress value={Math.min(Math.max(progress, 0), 100)} className="mt-2 h-1.5" />
      )}
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function EmptyHint({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      <div>{children}</div>
      {action}
    </div>
  );
}

export function ConfirmDelete({
  onConfirm,
  what = "this record",
  size = "icon",
  disabled,
}: {
  onConfirm: () => unknown;
  what?: string;
  size?: "icon" | "sm";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={size}
        className="text-muted-foreground hover:text-destructive"
        aria-label={`Delete ${what}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
        {size === "sm" && <span className="ml-1">Delete</span>}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {what}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes it from your records.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                await onConfirm();
                setOpen(false);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Labelled input; numeric inputs keep the raw string so users can type freely. */
export function Field({
  label,
  id,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  id?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function NumInput({
  value,
  onChange,
  step = "any",
  min,
  max,
  placeholder,
  id,
  className,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  step?: string;
  min?: number;
  max?: number;
  placeholder?: string;
  id?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      max={max}
      placeholder={placeholder}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      className={cn("tabular-nums", className)}
    />
  );
}

/** Parse an optional numeric form field. Returns undefined when invalid (caller shows error). */
export function parseOptNum(
  v: string,
  { min, max, int }: { min?: number; max?: number; int?: boolean } = {},
): number | null | undefined {
  if (v.trim() === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  if (int && !Number.isInteger(n)) return undefined;
  if (min !== undefined && n < min) return undefined;
  if (max !== undefined && n > max) return undefined;
  return n;
}

export const strOf = (n: number | null | undefined) =>
  n === null || n === undefined ? "" : String(n);

export function fmtNum(n: number | null | undefined, dp = 1): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString(undefined, {
    maximumFractionDigits: dp,
    minimumFractionDigits: 0,
  });
}

export function signed(n: number | null | undefined, dp = 2, unit = ""): string {
  if (n === null || n === undefined) return "—";
  const s = Number(n).toFixed(dp);
  return `${Number(n) > 0 ? "+" : ""}${s}${unit}`;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <div
      className={cn("inline-flex rounded-lg border bg-muted/40 p-0.5", className)}
      role="tablist"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function RatingPicker({
  value,
  onChange,
  max = 5,
  label,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  max?: number;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1" aria-label={label}>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(value === n ? null : n)}
          className={cn(
            "h-8 min-w-8 rounded-md border px-2 text-xs tabular-nums",
            value === n ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
          )}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/** Native select: fastest on mobile (uses the OS picker). */
export function NativeSelect({
  value,
  onChange,
  options,
  id,
  className,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  id?: string;
  className?: string;
  placeholder?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-input/20",
        className,
      )}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-popover text-popover-foreground">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  id: string;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        id={id}
        type="checkbox"
        className="h-4 w-4 accent-[var(--primary)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function StateBadge({ state }: { state: string }) {
  const cls: Record<string, string> = {
    raw: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
    cooked: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
    dry: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
    as_packaged: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
    not_applicable: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
  };
  const label: Record<string, string> = {
    raw: "Raw",
    cooked: "Cooked",
    dry: "Dry",
    as_packaged: "Packaged",
    not_applicable: "—",
  };
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        cls[state],
      )}
    >
      {label[state] ?? state}
    </span>
  );
}
