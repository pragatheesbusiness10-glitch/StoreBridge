import Papa from "papaparse";

export function toCsv(rows: Record<string, unknown>[]): string {
  return Papa.unparse(
    rows.map((r) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [
          k,
          v === null || v === undefined ? "" : Array.isArray(v) ? v.join(";") : v,
        ]),
      ),
    ),
  );
}

export function download(
  filename: string,
  content: string | Blob,
  mime = "text/csv;charset=utf-8",
) {
  const blob = typeof content === "string" ? new Blob(["﻿" + content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const downloadCsv = (filename: string, rows: Record<string, unknown>[]) =>
  download(filename, toCsv(rows));

/**
 * Print the current page to PDF via the browser's print dialog ("Save as PDF").
 * Temporarily switches to the light palette so the PDF is printer-friendly.
 */
export function printToPdf() {
  const html = document.documentElement;
  const wasDark = html.classList.contains("dark");
  if (wasDark) html.classList.remove("dark");
  const restore = () => {
    if (wasDark) html.classList.add("dark");
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  setTimeout(() => window.print(), 50);
}
