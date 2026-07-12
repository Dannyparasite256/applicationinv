import { formatCurrency } from '@/lib/utils';

/** Open a simple printable price tag for a product */
export function printProductLabel(opts: {
  name: string;
  price: number | string;
  sku?: string | null;
  barcode?: string | null;
  companyName?: string | null;
}) {
  const price = formatCurrency(Number(opts.price) || 0);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Label</title>
<style>
  @page { margin: 8mm; size: 60mm 40mm; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 8px; text-align: center; }
  .co { font-size: 10px; color: #666; margin-bottom: 4px; }
  .name { font-size: 14px; font-weight: 700; line-height: 1.2; margin: 4px 0; }
  .price { font-size: 20px; font-weight: 800; margin: 6px 0; }
  .meta { font-size: 10px; font-family: ui-monospace, monospace; color: #444; }
</style></head><body>
  <div class="co">${escapeHtml(opts.companyName || 'Enterprise IMS')}</div>
  <div class="name">${escapeHtml(opts.name)}</div>
  <div class="price">${escapeHtml(price)}</div>
  <div class="meta">${escapeHtml([opts.sku, opts.barcode].filter(Boolean).join(' · '))}</div>
  <script>window.onload=function(){window.print();}</script>
</body></html>`;
  const w = window.open('', '_blank', 'noopener,noreferrer,width=360,height=320');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
