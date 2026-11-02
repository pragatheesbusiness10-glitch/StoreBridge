import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { HardDriveDownload, HardDriveUpload, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { createBackup, restoreBackup } from "@/lib/pp/backup";
import { download } from "@/lib/pp/csv";
import { todayStr } from "@/lib/pp/dates";
import { db, errMsg } from "@/lib/pp/db";

/** Backup / restore / erase for the on-device database. */
export function BackupControls({
  allowErase = true,
  afterRestore,
}: {
  allowErase?: boolean;
  afterRestore?: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);

  const backup = async () => {
    setBusy(true);
    try {
      download(
        `prime-physique-backup-${todayStr()}.json`,
        await createBackup(),
        "application/json",
      );
      toast.success("Backup downloaded — keep it somewhere safe (e.g. cloud drive or computer)");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await restoreBackup(pending);
      await qc.invalidateQueries({ queryKey: ["pp"] });
      toast.success(`Restored ${r.rows} records and ${r.photos} photos`);
      setPending(null);
      if (afterRestore) afterRestore();
      else navigate({ to: "/fitness" });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const erase = async () => {
    setBusy(true);
    try {
      await db.eraseAll();
      qc.clear();
      toast.success("All Prime Physique data erased from this device");
      navigate({ to: "/fitness/onboarding", replace: true });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onClick={backup} disabled={busy}>
        <HardDriveDownload className="mr-1 h-4 w-4" /> Download full backup
      </Button>
      <Button size="sm" variant="secondary" onClick={() => input.current?.click()} disabled={busy}>
        <HardDriveUpload className="mr-1 h-4 w-4" /> Restore from backup
      </Button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-label="Backup file"
        onChange={(e) => setPending(e.target.files?.[0] ?? null)}
      />
      {allowErase && (
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          onClick={() => setConfirmErase(true)}
          disabled={busy}
        >
          <Trash2 className="mr-1 h-4 w-4" /> Erase all data
        </Button>
      )}

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              Everything currently stored on this device will be replaced by “{pending?.name}”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={restore}>Replace and restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmErase} onOpenChange={setConfirmErase}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Erase all data on this device?</AlertDialogTitle>
            <AlertDialogDescription>
              Every weigh-in, food entry, workout, measurement and photo will be permanently
              deleted. There is no cloud copy — download a backup first if you may need it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={erase}
            >
              Erase everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
