import multer from 'multer';
import { env } from '../config/env';

/**
 * Memory storage so logos can be persisted as durable data URLs in the database.
 * Disk under /uploads is ephemeral on platforms like Render and is wiped on redeploy.
 */
export const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.max(1, env.MAX_FILE_SIZE_MB || 5) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.startsWith('image/')) {
      cb(new Error('Only image files are allowed (JPG, PNG, WebP, GIF)'));
      return;
    }
    cb(null, true);
  },
});

/** Build a data-URL from a multer memory file (or empty string if invalid). */
export function fileToDataUrl(file: Express.Multer.File): string {
  const mime = file.mimetype && file.mimetype.startsWith('image/') ? file.mimetype : 'image/jpeg';
  const buf = file.buffer;
  if (!buf || !buf.length) {
    throw new Error('Empty image file');
  }
  // Cap stored logo size (~1.5MB base64 payload ≈ ~1.1MB raw) to keep DB/API responses healthy
  const maxBytes = 1.5 * 1024 * 1024;
  if (buf.length > maxBytes) {
    throw new Error('Logo is too large. Please use an image under 1.5 MB.');
  }
  return `data:${mime};base64,${buf.toString('base64')}`;
}
