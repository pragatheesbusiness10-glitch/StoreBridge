import { useState } from "react";
import { Droplet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useTableMutations } from "@/lib/pp/db";
import { NumInput, parseOptNum } from "./ui";

/** One-tap water logging (250 / 500 / 750 ml or a custom amount). */
export function WaterQuickAdd({ date, compact }: { date: string; compact?: boolean }) {
  const { insert } = useTableMutations("water_logs");
  const [custom, setCustom] = useState("");
  const add = async (ml: number) => {
    await insert.mutateAsync({
      log_date: date,
      amount_ml: ml,
      logged_at: new Date().toISOString(),
    });
    toast.success(`+${ml} ml water`);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {[250, 500, 750].map((ml) => (
        <Button
          key={ml}
          size="sm"
          variant="secondary"
          onClick={() => add(ml)}
          disabled={insert.isPending}
        >
          <Droplet className="mr-1 h-3.5 w-3.5" /> {ml} ml
        </Button>
      ))}
      {!compact && (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const v = parseOptNum(custom, { min: 1, max: 5000, int: true });
            if (!v) return toast.error("Enter 1–5000 ml");
            add(v);
            setCustom("");
          }}
        >
          <NumInput value={custom} onChange={setCustom} placeholder="ml" className="h-8 w-20" />
          <Button size="sm" type="submit" variant="outline">
            Add
          </Button>
        </form>
      )}
    </div>
  );
}
