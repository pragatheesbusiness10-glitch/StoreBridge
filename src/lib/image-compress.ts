// Client-side image compression using canvas — no external deps.
// Downscales to `maxDimension` and re-encodes as JPEG/WebP at `quality`.
// Falls back to the original file when compression would not save space
// or when the browser can't decode the file (SVG, HEIC without codec, etc.).

export type CompressOptions = {
  maxDimension?: number; // longest edge in px
  quality?: number; // 0..1
  mimeType?: "image/jpeg" | "image/webp";
  minBytesToCompress?: number; // skip files smaller than this
};

const DEFAULTS: Required<CompressOptions> = {
  maxDimension: 2000,
  quality: 0.85,
  mimeType: "image/jpeg",
  minBytesToCompress: 300 * 1024,
};

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode image"));
    };
    img.src = url;
  });
}

export async function compressImage(file: File, options: CompressOptions = {}): Promise<File> {
  const opts = { ...DEFAULTS, ...options };

  // Skip GIFs (animated frames would be lost), SVGs, and tiny files.
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/gif" || file.type === "image/svg+xml") return file;
  if (file.size < opts.minBytesToCompress) return file;

  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    return file;
  }

  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longest > opts.maxDimension ? opts.maxDimension / longest : 1;
  const targetW = Math.max(1, Math.round(img.naturalWidth * scale));
  const targetH = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, opts.mimeType, opts.quality),
  );
  if (!blob) return file;
  // Only swap if we actually saved bytes.
  if (blob.size >= file.size) return file;

  const ext = opts.mimeType === "image/webp" ? "webp" : "jpg";
  const baseName = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}.${ext}`, {
    type: opts.mimeType,
    lastModified: Date.now(),
  });
}