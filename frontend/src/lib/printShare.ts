import { Capacitor } from '@capacitor/core';
// Static imports avoid "Failed to fetch dynamically imported module" on Android WebView
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FileOpener } from '@capacitor-community/file-opener';
import { useAuthStore } from '@/stores/authStore';
import { useCurrencyStore } from '@/stores/currencyStore';
import { getApiBaseUrl } from '@/lib/config';

function apiBase(): string {
  return getApiBaseUrl();
}

function authHeaders(): HeadersInit {
  const token = useAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Dashboard / top-bar currency selected by admin — used on all receipts & invoices */
function selectedPrintCurrency(): string {
  const { displayCurrency, baseCurrency } = useCurrencyStore.getState();
  return (displayCurrency || baseCurrency || 'USD').toUpperCase();
}

function withCurrencyQuery(path: string, currency?: string): string {
  const cur = (currency || selectedPrintCurrency()).toUpperCase();
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}currency=${encodeURIComponent(cur)}`;
}

export type PrintDocType = 'receipt' | 'invoice';

export interface PrintBundle {
  type: PrintDocType;
  id: string;
  number: string;
  title: string;
  companyName: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  total: number;
  currency: string;
  baseCurrency?: string;
  currencyNote?: string;
  shareText: string;
  formats: Record<string, string>;
}

/** Fetch print metadata for a sale or invoice (amounts in dashboard display currency) */
export async function fetchPrintBundle(type: PrintDocType, id: string): Promise<PrintBundle> {
  const path = withCurrencyQuery(
    type === 'receipt' ? `/sales/${id}/print` : `/invoices/${id}/print`
  );
  const res = await fetch(`${apiBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load print options');
  const json = await res.json();
  return json.data as PrintBundle;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function safeFilename(name: string) {
  return name.replace(/[^\w.\-()+\s]/g, '_').replace(/\s+/g, '_').slice(0, 120);
}

/**
 * Write a blob to device storage and open it with a system app (PDF reader, etc.).
 * Also offers share so the user can save/download to Drive, Files, etc.
 */
export async function saveAndOpenFile(
  blob: Blob,
  filename: string,
  contentType: string,
  options?: { share?: boolean; open?: boolean }
): Promise<'opened' | 'shared' | 'downloaded'> {
  // Ensure PDF extension so Android picks a PDF reader correctly
  let name = safeFilename(filename);
  if (contentType.includes('pdf') && !name.toLowerCase().endsWith('.pdf')) {
    name = `${name}.pdf`;
  }
  const wantOpen = options?.open !== false;
  const wantShare = options?.share === true;

  if (Capacitor.isNativePlatform()) {
    const base64 = await blobToBase64(blob);
    // Documents is visible to the user and more reliable with FileOpener on Android
    const written = await Filesystem.writeFile({
      path: `EnterpriseIMS/${name}`,
      data: base64,
      directory: Directory.Documents,
      recursive: true,
    });

    let filePath = written.uri;
    // Some Android versions need content:// or absolute path — resolve URI if available
    try {
      const uri = await Filesystem.getUri({
        path: `EnterpriseIMS/${name}`,
        directory: Directory.Documents,
      });
      if (uri?.uri) filePath = uri.uri;
    } catch {
      /* use written.uri */
    }

    if (wantOpen) {
      try {
        await FileOpener.open({
          filePath,
          contentType: contentType.includes('pdf') ? 'application/pdf' : contentType,
          openWithDefault: true,
        });
        return 'opened';
      } catch {
        // No default PDF app — fall through to share sheet ("Open with…")
      }
    }

    try {
      await Share.share({
        title: name,
        text: `Enterprise IMS — ${name}`,
        url: filePath,
        dialogTitle: wantShare ? 'Save or share file' : 'Open with PDF reader…',
      });
      return 'shared';
    } catch {
      throw new Error(
        'Could not open PDF. Install a free PDF reader (Google PDF Viewer, Adobe, or Drive) and try again.'
      );
    }
  }

  // Browser / desktop — open in new tab (Chrome/Edge can print directly)
  const url = URL.createObjectURL(
    contentType.includes('pdf') && !blob.type.includes('pdf')
      ? new Blob([await blob.arrayBuffer()], { type: 'application/pdf' })
      : blob
  );
  if (wantOpen && !wantShare) {
    const w = window.open(url, '_blank');
    if (!w) {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return 'downloaded';
    }
    setTimeout(() => URL.revokeObjectURL(url), 180_000);
    return 'opened';
  }

  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}

/**
 * Print HTML in a new window (desktop/web) with reliable auto-print.
 * Important: do NOT use "noopener" on window.open — modern browsers return null and
 * writing document content fails silently.
 */
function printHtmlInBrowser(html: string, autoPrint: boolean): void {
  // Prefer blob URL so we keep a window handle even with popup policies
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  // No noopener — we need a usable Window reference on desktop
  let w: Window | null = null;
  try {
    w = window.open(url, '_blank', 'width=920,height=1100');
  } catch {
    w = null;
  }

  if (w) {
    // Wait for the blob document to load, then print
    const tryPrint = () => {
      try {
        if (autoPrint) {
          w!.focus();
          // Double-rAF + timeout covers Chrome/Safari load timing
          requestAnimationFrame(() => {
            setTimeout(() => {
              try {
                w!.print();
              } catch {
                /* user can use on-page Print button */
              }
            }, 400);
          });
        }
      } catch {
        /* ignore */
      }
    };

    // blob pages fire load on the new window
    w.addEventListener?.('load', tryPrint);
    // Fallback if load already fired
    setTimeout(tryPrint, 600);
    setTimeout(() => URL.revokeObjectURL(url), 180_000);
    return;
  }

  // Popup blocked — hidden iframe print (works on many desktop browsers)
  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', 'Print');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
  document.body.appendChild(iframe);

  const cleanup = () => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        iframe.remove();
      } catch {
        /* ignore */
      }
    }, 60_000);
  };

  iframe.onload = () => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc && !doc.body?.innerHTML) {
        // Some browsers need write into iframe
      }
      if (autoPrint) {
        setTimeout(() => {
          try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
          } catch {
            /* ignore */
          }
        }, 350);
      }
    } finally {
      cleanup();
    }
  };

  iframe.src = url;

  // If iframe load never fires, still clean up
  setTimeout(cleanup, 120_000);
}

/** Open authenticated HTML print view (browser) or PDF (native) for printing */
export async function openPrintHtml(type: PrintDocType, id: string, autoPrint = true) {
  // Native phone/tablet: open A4 PDF in system PDF app (Print from there — most reliable)
  if (Capacitor.isNativePlatform()) {
    await openPdf(type, id, {
      format: 'a4',
      download: false,
      filename:
        type === 'receipt'
          ? `Receipt-${id.slice(0, 8)}.pdf`
          : `Invoice-${id.slice(0, 8)}.pdf`,
    });
    return;
  }

  // Build path carefully so autoPrint + currency both apply
  const basePath =
    type === 'receipt' ? `/sales/${id}/print/html` : `/invoices/${id}/print/html`;
  let path = withCurrencyQuery(basePath);
  if (autoPrint) {
    path += path.includes('?') ? '&autoPrint=1' : '?autoPrint=1';
  }

  const res = await fetch(`${apiBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to open print view');
  const html = await res.text();
  printHtmlInBrowser(html, autoPrint);
}

/** Open PDF in system PDF reader (or download+share on phone) */
export async function openPdf(
  type: PrintDocType,
  id: string,
  options?: {
    format?: 'thermal80' | 'thermal58' | 'a4';
    download?: boolean;
    filename?: string;
    currency?: string;
  }
) {
  // Default A4 for best looking tables in PDF readers
  const format = options?.format || 'a4';
  const currency = options?.currency || selectedPrintCurrency();
  let path: string;
  if (type === 'receipt') {
    path = withCurrencyQuery(
      `/sales/${id}/print/pdf?format=${format}${options?.download ? '&download=1' : ''}`,
      currency
    );
  } else {
    const invBase = `/invoices/${id}/print/pdf`;
    path = withCurrencyQuery(
      options?.download ? `${invBase}?download=1` : invBase,
      currency
    );
  }
  const res = await fetch(`${apiBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load PDF from server');
  const raw = await res.blob();
  // Force PDF MIME so Android / iOS choose a PDF reader
  const blob = new Blob([await raw.arrayBuffer()], { type: 'application/pdf' });

  const filename =
    options?.filename ||
    (type === 'receipt'
      ? `Receipt-${format}-${currency}-${id.slice(0, 8)}.pdf`
      : `Invoice-${currency}-${id.slice(0, 8)}.pdf`);

  if (options?.download) {
    return saveAndOpenFile(blob, filename, 'application/pdf', {
      share: true,
      open: true,
    });
  }

  return saveAndOpenFile(blob, filename, 'application/pdf', {
    open: true,
    share: false,
  });
}

/** Convenience: always download / save PDF (receipt or invoice) */
export async function downloadPdf(
  type: PrintDocType,
  id: string,
  options?: { format?: 'thermal80' | 'thermal58' | 'a4'; filename?: string; currency?: string }
) {
  return openPdf(type, id, { ...options, download: true });
}

/** Download plain text (generic printers / Notepad / spoolers) */
export async function downloadText(type: PrintDocType, id: string, filename?: string) {
  const path = withCurrencyQuery(
    type === 'receipt' ? `/sales/${id}/print/text` : `/invoices/${id}/print/text`
  );
  const res = await fetch(`${apiBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load text file');
  const blob = new Blob([await res.blob()], { type: 'text/plain' });
  const name = filename || `${type}-${id.slice(0, 8)}.txt`;
  await saveAndOpenFile(blob, name, 'text/plain', { share: true, open: true });
}

/**
 * Download ESC/POS binary for thermal printer software:
 * RawBT, QZ Tray, PrintNode, ESC/POS printers over USB/network.
 */
export async function downloadEscPos(type: PrintDocType, id: string, filename?: string) {
  const path = withCurrencyQuery(
    type === 'receipt' ? `/sales/${id}/print/escpos` : `/invoices/${id}/print/escpos`
  );
  const res = await fetch(`${apiBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load ESC/POS data');
  const blob = new Blob([await res.blob()], { type: 'application/octet-stream' });
  const name = filename || `${type}-${id.slice(0, 8)}.bin`;
  await saveAndOpenFile(blob, name, 'application/octet-stream', { share: true, open: false });
}

/** Web Share API when available (mobile-friendly) */
export async function nativeShare(data: {
  title: string;
  text: string;
  url?: string;
  files?: File[];
}) {
  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({
        title: data.title,
        text: data.text,
        url: data.url,
        dialogTitle: data.title,
      });
      return;
    } catch {
      /* fall through */
    }
  }
  if (!navigator.share) throw new Error('Sharing is not supported on this device/browser');
  await navigator.share(data);
}

export function shareWhatsApp(text: string, phone?: string | null) {
  const digits = phone ? phone.replace(/[^\d]/g, '') : '';
  const base = digits ? `https://wa.me/${digits}` : 'https://wa.me/';
  const url = `${base}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

export function shareSms(text: string, phone?: string | null) {
  const body = encodeURIComponent(text);
  const href = phone ? `sms:${phone}?body=${body}` : `sms:?body=${body}`;
  window.location.href = href;
}

export function shareMailto(subject: string, body: string, to?: string | null) {
  const q = new URLSearchParams();
  if (subject) q.set('subject', subject);
  if (body) q.set('body', body);
  const href = `mailto:${to || ''}?${q.toString()}`;
  window.location.href = href;
}

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

export async function emailViaApi(type: PrintDocType, id: string, to?: string) {
  const path =
    type === 'receipt' ? `/sales/${id}/share/email` : `/invoices/${id}/share/email`;
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: to || undefined,
      currency: selectedPrintCurrency(),
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((json as { message?: string })?.message || 'Email failed');
  }
  return ((json as { data?: unknown }).data || json) as {
    sent?: boolean;
    to?: string;
    previewUrl?: string;
    preview?: string;
    reason?: string;
    mode?: string;
    messageId?: string;
  };
}
