import { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (!open || !id) return;
    let cancelled = false;
    setLoading(true);
    fetchPrintBundle(type, id)
      .then((b) => {
        if (cancelled) return;
        setBundle(b);
        setEmail(b.customerEmail || '');
        if (autoPrint) {
          openPrintHtml(type, id, true).catch(() => toast.error('Could not open print view'));
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

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <motion.div
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="relative w-full sm:max-w-lg max-h-[min(92dvh,100%)] overflow-y-auto overscroll-contain rounded-t-2xl sm:rounded-2xl border border-border bg-card shadow-2xl min-w-0"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-gradient-to-r from-primary/10 via-card to-accent/10 backdrop-blur px-3 sm:px-5 py-3 sm:py-4 min-w-0">
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-semibold tracking-tight truncate">Print, PDF & Share</h2>
                <p className="text-xs text-muted-foreground truncate">
                  {bundle?.title || (type === 'receipt' ? 'Sales receipt' : 'Customer invoice')}
                </p>
              </div>
              <Button variant="ghost" size="icon" className="shrink-0" onClick={onClose} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="p-3 sm:p-5 space-y-4 sm:space-y-5 pb-[max(1rem,env(safe-area-inset-bottom))] min-w-0">
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
                      <Badge variant="secondary">{type === 'receipt' ? 'Receipt' : 'Invoice'}</Badge>
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
                      <FileDown className="h-3.5 w-3.5" /> PDF &amp; print
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Opens a clean table layout in your PDF reader — use Print from that app.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Button
                        variant="default"
                        className="sm:col-span-2"
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
                                ? 'Opened in PDF app — print from there'
                                : result === 'shared'
                                  ? 'Choose a PDF app to open or print'
                                  : 'PDF ready'
                            );
                          })
                        }
                      >
                        <FileText className="h-4 w-4" /> Open PDF (print-ready A4)
                      </Button>
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
                                  result === 'opened' ? 'Opened in PDF app' : 'PDF ready to save/share'
                                );
                              })
                            }
                          >
                            <Download className="h-4 w-4" /> Save A4 PDF
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
                                  result === 'opened' ? 'Opened thermal PDF' : 'Thermal PDF ready'
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
                                  result === 'opened' ? 'Opened thermal PDF' : 'Thermal PDF ready'
                                );
                              })
                            }
                          >
                            <Download className="h-4 w-4" /> Thermal 58mm
                          </Button>
                        </>
                      ) : (
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
                                  ? 'Opened in PDF app'
                                  : 'Invoice PDF ready — save or share'
                              );
                            })
                          }
                        >
                          <Download className="h-4 w-4" /> Save invoice PDF
                        </Button>
                      )}
                    </div>
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Print
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Button
                        variant="secondary"
                        loading={busy === 'print'}
                        onClick={() =>
                          run('print', async () => {
                            await openPrintHtml(type, id, true);
                            toast.success('Opened for print — use your PDF app’s print option');
                          })
                        }
                      >
                        <Printer className="h-4 w-4" /> Print (PDF app)
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
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
                        variant="secondary"
                        size="sm"
                        loading={busy === 'escpos'}
                        onClick={() =>
                          run('escpos', async () => {
                            await downloadEscPos(type, id, `${bundle.number}.bin`);
                            toast.success('ESC/POS file ready for thermal apps');
                          })
                        }
                      >
                        <FileCode className="h-4 w-4" /> ESC/POS
                      </Button>
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
                            shareMailto(bundle.title, bundle.shareText, email || bundle.customerEmail);
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

                    <div className="flex gap-2 pt-1">
                      <Input
                        type="email"
                        placeholder="Customer email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
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
                                // Ethereal / debug preview for development SMTP
                                window.open(result.previewUrl, '_blank', 'noopener,noreferrer');
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
    </AnimatePresence>
  );
}
