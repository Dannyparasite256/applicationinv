import { Capacitor } from '@capacitor/core';
// Static import — dynamic import() fails in Capacitor WebView with
// "Failed to fetch dynamically imported module" (chunk path / SW issues).
import {
  BarcodeScanner,
  BarcodeFormat,
} from '@capacitor-mlkit/barcode-scanning';

/**
 * Scan a barcode / QR using the device camera (native) or browser APIs (web).
 * Returns the raw value, or null if the user cancels.
 */
export async function scanBarcode(options?: { title?: string }): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    return scanNative();
  }
  return scanWeb(options?.title);
}

async function scanNative(): Promise<string | null> {
  try {
    // Google Code Scanner (Android) often works without CAMERA permission,
    // but we still request it for broader device support.
    try {
      let perm = await BarcodeScanner.checkPermissions();
      if (perm.camera !== 'granted' && perm.camera !== 'limited') {
        perm = await BarcodeScanner.requestPermissions();
      }
      if (perm.camera !== 'granted' && perm.camera !== 'limited') {
        throw new Error(
          'Camera permission is required. Enable Camera for Enterprise IMS in phone Settings.'
        );
      }
    } catch (e) {
      // Re-throw our permission message; ignore other permission API quirks
      if (e instanceof Error && e.message.includes('Camera permission')) throw e;
    }

    // Install Google barcode module if needed (Play Services)
    try {
      const mod = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
      if (!mod.available) {
        await BarcodeScanner.installGoogleBarcodeScannerModule();
      }
    } catch {
      /* iOS / module already present */
    }

    const { barcodes } = await BarcodeScanner.scan({
      formats: [
        BarcodeFormat.Ean13,
        BarcodeFormat.Ean8,
        BarcodeFormat.UpcA,
        BarcodeFormat.UpcE,
        BarcodeFormat.Code128,
        BarcodeFormat.Code39,
        BarcodeFormat.Code93,
        BarcodeFormat.Itf,
        BarcodeFormat.Codabar,
        BarcodeFormat.QrCode,
        BarcodeFormat.DataMatrix,
      ],
    });

    const value = barcodes?.[0]?.rawValue?.trim();
    return value || null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const lower = msg.toLowerCase();
    if (
      lower.includes('cancel') ||
      lower.includes('user') ||
      lower.includes('activity') ||
      lower.includes('dismiss')
    ) {
      return null;
    }
    // Friendlier message — never surface "dynamically imported module"
    if (lower.includes('dynamically imported') || lower.includes('failed to fetch')) {
      throw new Error(
        'Camera scanner failed to load. Fully close and reopen the app, then try again. Or type the barcode manually.'
      );
    }
    throw e instanceof Error ? e : new Error(msg || 'Barcode scan failed');
  }
}

async function scanWeb(title?: string): Promise<string | null> {
  // Prefer BarcodeDetector when the browser supports it (Chrome / Edge)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const BD = (window as any).BarcodeDetector as
    | (new (opts?: { formats?: string[] }) => {
        detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
      })
    | undefined;

  const canUseCamera =
    typeof BD === 'function' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function';

  if (canUseCamera) {
    try {
      return await scanWithBarcodeDetector(BD!, title);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('notallowed')) {
        throw new Error('Camera permission denied. Allow camera access or type the barcode.');
      }
      // Fall through to manual entry
    }
  }

  const typed = window.prompt(title || 'Enter barcode value (camera unavailable)');
  return typed?.trim() || null;
}

async function scanWithBarcodeDetector(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  BarcodeDetectorCtor: any,
  title?: string
): Promise<string | null> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: false,
  });

  return new Promise<string | null>((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;';

    const label = document.createElement('p');
    label.textContent = title || 'Point the camera at a barcode';
    label.style.cssText = 'color:#fff;font:500 15px/1.4 system-ui,sans-serif;margin:0;text-align:center';

    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    video.style.cssText =
      'width:min(100%,420px);max-height:60vh;border-radius:16px;background:#111;object-fit:cover';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText =
      'margin-top:8px;padding:10px 20px;border-radius:10px;border:0;background:#334155;color:#fff;font:600 14px system-ui;cursor:pointer';

    overlay.append(label, video, cancelBtn);
    document.body.appendChild(overlay);

    video.srcObject = stream;
    void video.play();

    const detector = new BarcodeDetectorCtor({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'itf', 'codabar'],
    });

    let done = false;
    let timer: number | undefined;

    const cleanup = (value: string | null) => {
      if (done) return;
      done = true;
      if (timer) window.clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      overlay.remove();
      resolve(value);
    };

    cancelBtn.onclick = () => cleanup(null);

    timer = window.setInterval(async () => {
      if (done || video.readyState < 2) return;
      try {
        const codes = await detector.detect(video);
        const raw = codes?.[0]?.rawValue?.trim();
        if (raw) cleanup(raw);
      } catch {
        /* keep scanning */
      }
    }, 350);
  });
}

/** Whether native / camera scanning is likely available */
export function canUseCameraScan(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  return !!(navigator.mediaDevices?.getUserMedia);
}
