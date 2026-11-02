import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_PROFILE,
  ProfileFields,
  toPayload,
  valuesFrom,
  type ProfileFormValues,
} from "@/components/pp/profile-form";
import { BackupControls } from "@/components/pp/backup-panel";
import { db, errMsg, useProfile, useProgram } from "@/lib/pp/db";

export const Route = createFileRoute("/fitness/onboarding")({
  component: Onboarding,
});

function Onboarding() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const profileQ = useProfile();
  const programQ = useProgram();
  const [v, setV] = useState<ProfileFormValues>(DEFAULT_PROFILE);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (profileQ.data) setV(valuesFrom(profileQ.data, programQ.data ?? null));
  }, [profileQ.data, programQ.data]);

  const setupError = profileQ.error ? errMsg(profileQ.error) : null;

  const submit = async () => {
    const payload = toPayload(v);
    if ("error" in payload) return toast.error(payload.error);
    setBusy(true);
    try {
      const { error: pe } = await db
        .from("fitness_profiles")
        .upsert({ ...payload.profile, onboarded_at: new Date().toISOString() });
      if (pe) throw pe;
      if (programQ.data) {
        const { error } = await db
          .from("transformation_programs")
          .update(payload.program)
          .eq("id", programQ.data.id);
        if (error) throw error;
      } else {
        const { error } = await db.from("transformation_programs").insert(payload.program);
        if (error) throw error;
      }
      const { error: se } = await db.rpc("pp_seed_defaults");
      if (se) throw se;
      await qc.invalidateQueries({ queryKey: ["pp"] });
      toast.success(
        "Profile saved. Default food database, exercise library and 6-day plan are ready.",
      );
      navigate({ to: "/fitness", replace: true });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Zap className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome to Prime Physique</h1>
          <p className="text-sm text-muted-foreground">
            Confirm your starting profile. Every field can be edited later in Settings.
          </p>
        </div>
      </div>
      {setupError && (
        <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
          Your on-device storage could not be opened ({setupError}). Private/incognito windows or
          blocked site data can prevent offline storage — open Prime Physique in a normal window.
        </div>
      )}
      <div className="rounded-xl border bg-card p-4 sm:p-6">
        <ProfileFields v={v} setV={setV} />
        <div className="mt-6 flex justify-end">
          <Button size="lg" onClick={submit} disabled={busy}>
            {busy ? "Setting up…" : "Start my transformation"}
          </Button>
        </div>
      </div>
      <div className="mt-4 rounded-xl border bg-card p-4">
        <div className="text-sm font-medium">Moving from another device?</div>
        <p className="mb-2 text-xs text-muted-foreground">
          Prime Physique is offline and stores everything on this device. Restore a backup file from
          your old device instead of starting again.
        </p>
        <BackupControls allowErase={false} />
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Prime Physique is a tracking tool, not medical advice. Discuss calorie targets and
        weight-loss rates with a qualified professional, especially if you have a medical condition.
      </p>
    </div>
  );
}
