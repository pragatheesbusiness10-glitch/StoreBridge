import { useState } from "react";
import { Input } from "@/components/ui/input";
import { presetRange, todayStr, type DateRange, type RangePreset } from "@/lib/pp/dates";
import { Segmented } from "./ui";

export function useDateRange(initial: Exclude<RangePreset, "custom"> = "30") {
  const [preset, setPreset] = useState<RangePreset>(initial);
  const [custom, setCustom] = useState<DateRange>(presetRange(initial));
  const range: DateRange = preset === "custom" ? custom : presetRange(preset);
  return { preset, setPreset, custom, setCustom, range };
}

export function DateRangeFilter({ state }: { state: ReturnType<typeof useDateRange> }) {
  const { preset, setPreset, custom, setCustom } = state;
  return (
    <div className="flex flex-wrap items-center gap-2 pp-no-print">
      <Segmented
        value={preset}
        onChange={(v) => {
          if (v === "custom") setCustom(state.range);
          setPreset(v);
        }}
        options={[
          { value: "7", label: "7d" },
          { value: "14", label: "14d" },
          { value: "30", label: "30d" },
          { value: "90", label: "90d" },
          { value: "custom", label: "Custom" },
        ]}
      />
      {preset === "custom" && (
        <div className="flex items-center gap-1">
          <Input
            type="date"
            aria-label="From date"
            className="h-8 w-[9.5rem]"
            value={custom.from}
            max={custom.to}
            onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            aria-label="To date"
            className="h-8 w-[9.5rem]"
            value={custom.to}
            min={custom.from}
            max={todayStr()}
            onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
