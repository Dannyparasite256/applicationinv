/**
 * Compress product / profile photos to a durable data URL for API + multi-device sync.
 * Data URLs are stored in Postgres and work on web, Android, and desktop without /uploads disk.
 */

export type CompressOptions = {
  /** Longest edge in pixels (default 900) */
  maxEdge?: number;
  /** JPEG quality 0–1 (default 0.82) */
  quality?: number;
  /** Soft cap after encode; re-encodes lower quality if exceeded (default ~500KB) */
  maxBytes?: number;
};

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

function canvasToJpegDataUrl(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<{ dataUrl: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Image encode failed'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result || '');
          resolve({ dataUrl, bytes: blob.size });
        };
        reader.onerror = () => reject(new Error('Image encode failed'));
        reader.readAsDataURL(blob);
      },
      'image/jpeg',
      quality
    );
  });
}

/**
 * Resize + JPEG-compress an image File/Blob into a data:image/jpeg;base64,... string
 * suitable for storing on Product.imageUrl / Company.logoUrl.
 */
export async function compressImageToDataUrl(
  file: File | Blob,
  opts: CompressOptions = {}
): Promise<string> {
  const maxEdge = opts.maxEdge ?? 900;
  const maxBytes = opts.maxBytes ?? 500 * 1024;
  let quality = opts.quality ?? 0.82;

  // Already a small data URL string path is not used here — always encode from File
  const img = await loadImage(file);
  let { width, height } = img;
  if (!width || !height) throw new Error('Invalid image dimensions');

  const scale = Math.min(1, maxEdge / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  let { dataUrl, bytes } = await canvasToJpegDataUrl(canvas, quality);

  // Progressive quality drop if still large
  while (bytes > maxBytes && quality > 0.45) {
    quality = Math.max(0.45, quality - 0.12);
    ({ dataUrl, bytes } = await canvasToJpegDataUrl(canvas, quality));
  }

  // Last resort: shrink dimensions
  if (bytes > maxBytes) {
    const shrink = Math.sqrt(maxBytes / bytes);
    const w2 = Math.max(1, Math.round(width * shrink));
    const h2 = Math.max(1, Math.round(height * shrink));
    canvas.width = w2;
    canvas.height = h2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w2, h2);
    ctx.drawImage(img, 0, 0, w2, h2);
    ({ dataUrl } = await canvasToJpegDataUrl(canvas, 0.7));
  }

  if (!dataUrl.startsWith('data:image/')) {
    throw new Error('Failed to compress image');
  }
  return dataUrl;
}

/** True if value is a durable inlined image (survives redeploy / reinstall). */
export function isDataImageUrl(url?: string | null): boolean {
  return !!url && /^data:image\//i.test(url);
}
