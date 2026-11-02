import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { nowTimeStr, todayStr } from "@/lib/pp/dates";
import { db, errMsg, useTableMutations } from "@/lib/pp/db";
import type { WeightLog } from "@/lib/pp/types";
import { Field, NumInput, Toggle, parseOptNum, strOf } from "./ui";

export function WeightDialog({
  open,
  onOpenChange,
  date,
  edit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  date?: string;
  edit?: WeightLog | null;
}) {
  const { insert, update } = useTableMutations("daily_weight_logs");
  const [d, setD] = useState(date ?? todayStr());
  const [w, setW] = useState("");
  const [time, setTime] = useState(nowTimeStr());
  const [toilet, setToilet] = useState(true);
  const [fasted, setFasted] = useState(true);
  const [evening, setEvening] = useState("");
  const [notes, setNotes] = useState("");
  const [existing, setExisting] = useState<WeightLog | null>(null);

  const load = (row: WeightLog | null, dateStr: string) => {
    setExisting(row);
    setD(dateStr);
    setW(strOf(row?.morning_weight_kg));
    setTime(row?.measured_at?.slice(0, 5) ?? nowTimeStr());
    setToilet(row?.after_toilet ?? true);
    setFasted(row?.before_food_water ?? true);
    setEvening(strOf(row?.evening_weight_kg));
    setNotes(row?.notes ?? "");
  };

  useEffect(() => {
    if (!open) return;
    if (edit) return load(edit, edit.log_date);
    const target = date ?? todayStr();
    db.from("daily_weight_logs")
      .select("*")
      .eq("log_date", target)
      .maybeSingle()
      .then(({ data }) => load((data as WeightLog) ?? null, target));
  }, [open, edit, date]);

  // If the user changes the date, load that day's entry (one morning weight per day).
  const changeDate = async (v: string) => {
    if (!v) return;
    const { data } = await db.from("daily_weight_logs").select("*").eq("log_date", v).maybeSingle();
    load((data as WeightLog) ?? null, v);
  };

  const save = async () => {
    const mw = parseOptNum(w, { min: 20, max: 400 });
    const ew = parseOptNum(evening, { min: 20, max: 400 });
    if (!mw) return toast.error("Enter a morning weight between 20 and 400 kg");
    if (ew === undefined) return toast.error("Evening weight must be between 20 and 400 kg");
    const row = {
      log_date: d,
      morning_weight_kg: mw,
      measured_at: time || null,
      after_toilet: toilet,
      before_food_water: fasted,
      evening_weight_kg: ew,
      notes: notes.trim() || null,
    };
    try {
      if (existing) await update.mutateAsync({ id: existing.id, patch: row });
      else await insert.mutateAsync(row);
      toast.success(existing ? "Weight updated" : "Weight logged");
      onOpenChange(false);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit weigh-in" : "Log weight"}</DialogTitle>
          <DialogDescription>
            For comparable readings: same scale, morning, after the toilet, before food and water.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" id="w-date">
            <Input
              id="w-date"
              type="date"
              value={d}
              max={todayStr()}
              onChange={(e) => changeDate(e.target.value)}
            />
          </Field>
          <Field label="Time" id="w-time">
            <Input id="w-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Morning weight (kg)" id="w-kg" className="col-span-2">
            <NumInput
              id="w-kg"
              value={w}
              onChange={setW}
              step="0.05"
              placeholder="e.g. 93.25"
              autoFocus
              className="h-12 text-2xl font-semibold"
            />
          </Field>
          <div className="col-span-2 space-y-2">
            <Toggle
              id="w-toilet"
              checked={toilet}
              onChange={setToilet}
              label="After using the toilet"
            />
            <Toggle
              id="w-fasted"
              checked={fasted}
              onChange={setFasted}
              label="Before food and water"
            />
          </div>
          <Field label="Evening weight (optional, kg)" id="w-eve" className="col-span-2">
            <NumInput id="w-eve" value={evening} onChange={setEvening} step="0.05" />
          </Field>
          <Field label="Notes" id="w-notes" className="col-span-2">
            <Textarea
              id="w-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. salty dinner, poor sleep"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={insert.isPending || update.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
