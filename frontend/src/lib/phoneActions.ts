/**
 * Helpers to open the device dialer / SMS composer for a customer phone number.
 * Uses tel: and sms: intents — no CALL_PHONE permission required (opens dialer, not auto-call).
 */

export function normalizePhoneForDial(raw: string | null | undefined): string {
  if (!raw) return '';
  // Keep + and digits only
  return String(raw).replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
}

export function hasPhoneNumber(raw: string | null | undefined): boolean {
  const n = normalizePhoneForDial(raw);
  // Need enough digits for a real number
  return n.replace(/\D/g, '').length >= 7;
}

/** Open the native phone dialer with the number filled in. */
export function callPhone(raw: string | null | undefined): void {
  const phone = normalizePhoneForDial(raw);
  if (!phone) throw new Error('No phone number');
  // tel: opens dialer (ACTION_DIAL) — user still taps Call
  window.location.href = `tel:${phone}`;
}

/** Open SMS app with the recipient pre-filled (optional body). */
export function messagePhone(raw: string | null | undefined, body?: string): void {
  const phone = normalizePhoneForDial(raw);
  if (!phone) throw new Error('No phone number');
  // Android: sms:number?body=  ·  iOS: sms:number&body=
  const sep = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? '&' : '?';
  const href = body
    ? `sms:${phone}${sep}body=${encodeURIComponent(body)}`
    : `sms:${phone}`;
  window.location.href = href;
}

/** Open WhatsApp chat if installed / via web. */
export function whatsAppPhone(raw: string | null | undefined, text?: string): void {
  const digits = normalizePhoneForDial(raw).replace(/\D/g, '');
  if (!digits) throw new Error('No phone number');
  const url = text
    ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
    : `https://wa.me/${digits}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
