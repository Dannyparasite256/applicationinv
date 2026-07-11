import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { env } from '../config/env';

const uploadRoot = path.resolve(process.cwd(), env.UPLOAD_DIR);
const logosDir = path.join(uploadRoot, 'logos');

try {
  fs.mkdirSync(logosDir, { recursive: true });
} catch {
  /* ignore */
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      fs.mkdirSync(logosDir, { recursive: true });
    } catch {
      /* ignore */
    }
    cb(null, logosDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
    const companyId = (req as { companyId?: string }).companyId || 'company';
    cb(null, `${companyId}-${Date.now()}${safeExt}`);
  },
});

export const logoUpload = multer({
  storage,
  limits: { fileSize: Math.max(1, env.MAX_FILE_SIZE_MB || 5) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.startsWith('image/')) {
      cb(new Error('Only image files are allowed (JPG, PNG, WebP, GIF)'));
      return;
    }
    cb(null, true);
  },
});
