import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDaysStr, fmtDate, todayStr } from "@/lib/pp/dates";

export function DayNav({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const today = todayStr();
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        aria-label="Previous day"
        onClick={() => onChange(addDaysStr(date, -1))}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Input
        type="date"
        aria-label="Date"
        className="h-8 w-[9.5rem]"
        value={date}
        max={today}
        onChange={(e) => e.target.value && onChange(e.target.value)}
      />
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        aria-label="Next day"
        disabled={date >= today}
        onClick={() => onChange(addDaysStr(date, 1))}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      {date !== today && (
        <Button variant="ghost" size="sm" onClick={() => onChange(today)}>
          Today
        </Button>
      )}
      <span className="ml-1 hidden text-sm text-muted-foreground sm:inline">
        {fmtDate(date, "EEEE")}
      </span>
    </div>
  );
}
