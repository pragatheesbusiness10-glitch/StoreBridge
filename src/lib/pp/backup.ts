import { db } from "./db";
import type { Row } from "./local-db";

/** Full-fidelity backup of everything on this device (all tables + progress photos). */
export interface BackupFile {
  app: "prime-physique";
  version: 1;
  exported_at: string;
  tables: Record<string, Row[]>;
  files: { path: string; type: string; data: string }[]; // base64
}

const toBase64 = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromBase64 = (s: string, type: string) => {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
};

export async function createBackup(): Promise<Blob> {
  const { tables, files } = await db.exportAll();
  const out: BackupFile = {
    app: "prime-physique",
    version: 1,
    exported_at: new Date().toISOString(),
    tables,
    files: await Promise.all(
      files.map(async ([path, blob]) => ({
        path,
        type: blob.type || "image/jpeg",
        data: await toBase64(blob),
      })),
    ),
  };
  return new Blob([JSON.stringify(out)], { type: "application/json" });
}

/** Replace everything on this device with the contents of a backup file. */
export async function restoreBackup(file: File): Promise<{ rows: number; photos: number }> {
  let parsed: BackupFile;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("This file is not a Prime Physique backup (invalid JSON)");
  }
  if (
    parsed?.app !== "prime-physique" ||
    parsed.version !== 1 ||
    typeof parsed.tables !== "object"
  ) {
    throw new Error("This file is not a Prime Physique backup");
  }
  await db.importAll(
    parsed.tables,
    (parsed.files ?? []).map((f) => [f.path, fromBase64(f.data, f.type)] as [string, Blob]),
  );
  return {
    rows: Object.values(parsed.tables).reduce((a, t) => a + (Array.isArray(t) ? t.length : 0), 0),
    photos: parsed.files?.length ?? 0,
  };
}
