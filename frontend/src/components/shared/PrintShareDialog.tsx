import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Printer,
  Download,
  FileText,
  Share2,
  MessageCircle,
  Mail,
  Copy,
  X,
  Smartphone,
  FileCode,
  FileDown,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import {
  PrintDocType,
  PrintBundle,
  fetchPrintBundle,
  openPrintHtml,
  openPdf,
  downloadPdf,
  downloadText,
  downloadEscPos,
  nativeShare,
  shareWhatsApp,
  shareMailto,
  shareSms,
  copyText,
  emailViaApi,
} from '@/lib/printShare';
import { formatCurrency } from '@/lib/utils';
import { Capacitor } from '@capacitor/core';

interface Props {
  open: boolean;
  onClose: () => void;
  type: PrintDocType;
  id: string;
  autoPrint?: boolean;
}

export function PrintShareDialog({ open, onClose, type, id, autoPrint }: Props) {
  const [bundle, setBundle] = useState<PrintBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!open || !id) return;
    let cancelled = false;
    setLoading(true);
    setBundle(null);
    fetchPrintBundle(type, id)
      .then((b) => {
        if (cancelled) return;
        setBundle(b);
        setEmail(b.customerEmail || '');
        if (autoPrint) {
          openPrintHtml(type, id, true).catch(() =>
            toast.error('Could not open print view — try Open PDF instead')
          );
        }
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, type, id, autoPrint]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const run = async (key: string, fn: () => Promise<void>) => {
    try {
      setBusy(key);
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  if (typeof document === 'undefined') return null;

  // Portal to body so fixed positioning is relative to the viewport
  // (parent framer-motion transforms would pin the sheet to the page bottom).
  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="print-share-overlay fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Print, PDF and share"
        >
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="print-share-sheet relative z-10 w-full max-w-lg max-h-[min(88dvh,40rem)] flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl min-w-0 mx-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 flex items-center justify-between gap-2 border-b border-border bg-gradient-to-r from-primary/10 via-card to-accent/10 px-3 sm:px-5 py-3 sm:py-4 min-w-0">
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-semibold tracking-tight truncate">
                  Print, PDF & Share
                </h2>
                <p className="text-xs text-muted-foreground truncate">
                  {bundle?.title || (type === 'receipt' ? 'Sales receipt' : 'Customer invoice')}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={onClose}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-5 space-y-4 sm:space-y-5 pb-[max(1rem,env(safe-area-inset-bottom))] min-w-0">
              {loading && (
                <div className="space-y-2">
                  <div className="h-20 rounded-xl bg-muted animate-pulse" />
                  <div className="h-10 rounded-lg bg-muted animate-pulse" />
                </div>
              )}

              {bundle && (
                <>
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl border border-border bg-gradient-to-br from-muted/50 to-muted/20 p-4 text-sm space-y-1 shadow-inner"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold font-mono">{bundle.number}</span>
                      <Badge variant="secondary">
                        {type === 'receipt' ? 'Receipt' : 'Invoice'}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground">{bundle.companyName}</p>
                    <p>
                      Customer: <span className="font-medium">{bundle.customerName}</span>
                    </p>
                    <p className="text-2xl font-bold tabular-nums text-primary pt-1">
                      {formatCurrency(bundle.total, {
                        currency: bundle.currency,
                        from: bundle.currency,
                        raw: true,
                      })}
                    </p>
                    <p className="text-[11px] text-muted-foreground pt-0.5">
                      {bundle.currencyNote ||
                        `Shown in ${bundle.currency}${
                          bundle.baseCurrency && bundle.baseCurrency !== bundle.currency
                            ? ` (from ${bundle.baseCurrency})`
                            : ''
                        }`}
                    </p>
                  </motion.div>

                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                      <Printer className="h-3.5 w-3.5" /> Print
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {isNative
                        ? 'Opens a PDF in your phone’s reader — use Print there.'
                        : 'Opens a print-ready page and the system print dialog on your computer.'}
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                      <Button
                        variant="default"
                        className="w-full h-11 text-base font-semibold"
                        loading={busy === 'print'}
                        onClick={() =>
                          run('print', async () => {
                            await openPrintHtml(type, id, true);
                            toast.success(
                              isNative
                                ? 'Opened in PDF app — use Print'
                                : 'Print dialog should open — choose your printer'
                            );
                          })
                        }
                      >
                        <Printer className="h-5 w-5" />{' '}
                        {isNative ? 'Print (open PDF)' : 'Print now'}
                      </Button>
                      <Button
                        variant="secondary"
                        className="w-full"
                        loading={busy === 'pdf-view'}
                        onClick={() =>
                          run('pdf-view', async () => {
                            const result = await openPdf(type, id, {
                              format: 'a4',
                              download: false,
                              filename: `${bundle.number}.pdf`,
                            });
                            toast.success(
                              result === 'opened'
                                ? isNative
                                  ? 'Opened in PDF app'
                                  : 'PDF opened — use browser Print (Ctrl+P)'
                                : result === 'shared'
                                  ? 'Choose an app to open or print'
                                  : 'PDF ready'
                            );
                          })
                        }
                      >
                        <FileText className="h-4 w-4" /> Open PDF (A4)
                      </Button>
                    </div>
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                      <FileDown className="h-3.5 w-3.5" /> Save PDF
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {type === 'receipt' ? (
                        <>
                          <Button
                            variant="outline"
                            loading={busy === 'pdfa4'}
                            onClick={() =>
                              run('pdfa4', async () => {
                                const result = await downloadPdf(type, id, {
                                  format: 'a4',
                                  filename: `${bundle.number}-A4.pdf`,
                                });
                                toast.success(
                                  result === 'opened' ? 'Opened A4 PDF' : 'A4 PDF ready'
                                );
                              })
                            }
                          >
                            <Download className="h-4 w-4" /> A4 PDF
                          </Button>
                          <Button
                            variant="outline"
                            loading={busy === 'pdf80'}
                            onClick={() =>
                              run('pdf80', async () => {
                                const result = await downloadPdf(type, id, {
                                  format: 'thermal80',
                                  filename: `${bundle.number}-80mm.pdf`,
                                });
                                toast.success(
                                  result === 'opened' ? 'Opened 80mm PDF' : '80mm PDF ready'
                                );
                              })
                            }
                          >
                            <Download className="h-4 w-4" /> Thermal 80mm
                          </Button>
                          <Button
                            variant="outline"
                            loading={busy === 'pdf58'}
                            onClick={() =>
                              run('pdf58', async () => {
                                const result = await downloadPdf(type, id, {
                                  format: 'thermal58',
                                  filename: `${bundle.number}-58mm.pdf`,
                                });
                                toast.success(
                                  result === 'opened' ? 'Opened 58mm PDF' : '58mm PDF ready'
                                );
                              })
                            }
                          >
                            <Download className="h-4 w-4" /> Thermal 58mm
                          </Button>
                          <Button
                            variant="outline"
                            loading={busy === 'txt'}
                            onClick={() =>
                              run('txt', async () => {
                                await downloadText(type, id, `${bundle.number}.txt`);
                                toast.success('Text file ready');
                              })
                            }
                          >
                            <FileText className="h-4 w-4" /> Plain text
                          </Button>
                          <Button
                            variant="outline"
                            className="sm:col-span-2"
                            loading={busy === 'escpos'}
                            onClick={() =>
                              run('escpos', async () => {
                                await downloadEscPos(type, id, `${bundle.number}.bin`);
                                toast.success('ESC/POS file ready for thermal apps');
                              })
                            }
                          >
                            <FileCode className="h-4 w-4" /> ESC/POS (thermal software)
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            className="sm:col-span-2"
                            loading={busy === 'pdf-dl'}
                            onClick={() =>
                              run('pdf-dl', async () => {
                                const result = await downloadPdf(type, id, {
                                  filename: `${bundle.number}.pdf`,
                                });
                                toast.success(
                                  result === 'opened'
                                    ? 'Opened invoice PDF'
                                    : 'Invoice PDF ready — save or share'
                                );
                              })
                            }
                          >
                            <Download className="h-4 w-4" /> Save invoice PDF
                          </Button>
                          <Button
                            variant="outline"
                            loading={busy === 'txt'}
                            onClick={() =>
                              run('txt', async () => {
                                await downloadText(type, id, `${bundle.number}.txt`);
                                toast.success('Text file ready');
                              })
                            }
                          >
                            <FileText className="h-4 w-4" /> Plain text
                          </Button>
                        </>
                      )}
                    </div>
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Share
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        loading={busy === 'wa'}
                        onClick={() =>
                          run('wa', async () => {
                            shareWhatsApp(bundle.shareText, bundle.customerPhone);
                          })
                        }
                      >
                        <MessageCircle className="h-4 w-4" /> WhatsApp
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        loading={busy === 'sms'}
                        onClick={() =>
                          run('sms', async () => {
                            shareSms(bundle.shareText, bundle.customerPhone);
                          })
                        }
                      >
                        <Smartphone className="h-4 w-4" /> SMS
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        loading={busy === 'mail'}
                        onClick={() =>
                          run('mail', async () => {
                            shareMailto(
                              bundle.title,
                              bundle.shareText,
                              email || bundle.customerEmail
                            );
                          })
                        }
                      >
                        <Mail className="h-4 w-4" /> Mail
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        loading={busy === 'copy'}
                        onClick={() =>
                          run('copy', async () => {
                            await copyText(bundle.shareText);
                            toast.success('Copied');
                          })
                        }
                      >
                        <Copy className="h-4 w-4" /> Copy
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        loading={busy === 'native'}
                        onClick={() =>
                          run('native', async () => {
                            await nativeShare({
                              title: bundle.title,
                              text: bundle.shareText,
                            });
                          })
                        }
                      >
                        <Share2 className="h-4 w-4" /> Share
                      </Button>
                    </div>

                    <div className="flex gap-2 pt-1 min-w-0">
                      <Input
                        type="email"
                        placeholder="Customer email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="min-w-0 flex-1"
                      />
                      <Button
                        loading={busy === 'api-email'}
                        onClick={() =>
                          run('api-email', async () => {
                            const result = await emailViaApi(type, id, email || undefined);
                            if (result.sent) {
                              toast.success(
                                result.previewUrl
                                  ? `Emailed to ${result.to} (preview available)`
                                  : `Emailed to ${result.to}`
                              );
                              if (result.previewUrl) {
                                window.open(result.previewUrl, '_blank');
                              }
                            } else {
                              toast.error(result.reason || 'Email not sent');
                              if (result.preview) await copyText(result.preview);
                            }
                          })
                        }
                      >
                        <Mail className="h-4 w-4" /> Send
                      </Button>
                    </div>
                  </section>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
