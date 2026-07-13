import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { getApiBaseUrl } from '@/lib/config';
import { formatCurrency, formatDate, parseMoneyToBase, displayCurrencyCode } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { useCurrencyStore } from '@/stores/currencyStore';
import { canRefundOrDeleteSales } from '@/lib/roleAccess';
import { APP_FONTS } from '@/lib/fonts';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import {
  Download,
  FileSpreadsheet,
  FileText,
  Printer,
  Plus,
  RefreshCw,
  Package,
  Share2,
  UserCheck,
  Camera,
  Building2,
  ImagePlus,
  Type,
  ChevronRight,
  Contact,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { canPickDeviceContact, pickDeviceContact } from '@/native/pickContact';
import { PhoneActions } from '@/components/shared/PhoneActions';
import { PrintShareDialog } from '@/components/shared/PrintShareDialog';
import { Link } from 'react-router-dom';

function PageShell({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-container">
      <div className="page-header">
        <div className="min-w-0 flex-1">
          <h1 className="page-title">{title}</h1>
          {description && <p className="page-subtitle">{description}</p>}
        </div>
        {action && <div className="page-actions">{action}</div>}
      </div>
      <div className="stack-y fit-x">{children}</div>
    </div>
  );
}

function DataTable({ columns, rows }: { columns: string[]; rows: React.ReactNode[][] }) {
  return (
    <Card className="fit-x">
      <CardContent className="p-0 table-scroll">
        <table className="w-full text-[11px] sm:text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              {columns.map((c) => (
                <th key={c} className="px-2 sm:px-3 py-2 font-medium whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">
                  No records found
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border/60 hover:bg-muted/30">
                {row.map((cell, j) => (
                  <td key={j} className="px-2 sm:px-3 py-1.5 sm:py-2.5 max-w-[12rem] sm:max-w-[18rem]">
                    <div className="min-w-0 overflow-hidden">{cell}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

async function downloadAuth(path: string, filename: string) {
  const token = useAuthStore.getState().accessToken;
  const base = getApiBaseUrl();
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function openPdf(path: string) {
  const token = useAuthStore.getState().accessToken;
  const base = getApiBaseUrl();
  // Authenticated fetch + blob URL (do not open the API URL bare â€” auth header is required)
  fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => {
      if (!r.ok) throw new Error('PDF request failed');
      return r.blob();
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    })
    .catch(() => toast.error('Could not open PDF'));
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• SALES â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
/** After refund/delete/charge â€” refresh every surface that shows sales or money. */
function invalidateAfterSaleChange(qc: ReturnType<typeof useQueryClient>) {
  const keys = [
    'sales',
    'dashboard',
    'products',
    'products-mini',
    'pos-products-search',
    'pos-products',
    'stock-levels',
    'stock-movements',
    'low-stock',
    'current-shift',
    'reports',
    'report-sales',
    'report-profit',
    'invoices',
  ] as const;
  for (const key of keys) {
    void qc.invalidateQueries({ queryKey: [key], refetchType: 'active' });
  }
  // Force dashboard/sales to re-fetch now (not only when the page remounts)
  void qc.refetchQueries({ queryKey: ['dashboard'], type: 'all' });
  void qc.refetchQueries({ queryKey: ['sales'], type: 'all' });
  void qc.refetchQueries({ queryKey: ['products'], type: 'all' });
  void qc.refetchQueries({ queryKey: ['stock-levels'], type: 'all' });
}

export function SalesPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canReverseSales = canRefundOrDeleteSales(user?.roles || [], user?.permissions || []);
  const [printId, setPrintId] = useState<string | null>(null);
  const [autoPrint, setAutoPrint] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [refundMode, setRefundMode] = useState<'FULL' | 'PARTIAL'>('FULL');
  const [partialQty, setPartialQty] = useState<Record<string, string>>({});

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['sales', search, status, from, to],
    queryFn: async () =>
      (
        await api.get('/sales', {
          params: {
            limit: 50,
            search: search || undefined,
            status: status || undefined,
            from: from || undefined,
            to: to || undefined,
          },
        })
      ).data,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['sale-detail', detailId],
    enabled: !!detailId,
    queryFn: async () => (await api.get(`/sales/${detailId}`)).data.data,
  });

  const refund = useMutation({
    mutationFn: async (payload: {
      id: string;
      mode?: 'FULL' | 'PARTIAL';
      items?: Array<{ saleItemId: string; quantity: number }>;
    }) =>
      api.post(`/sales/${payload.id}/refund`, {
        reason: payload.mode === 'PARTIAL' ? 'Partial return' : 'Customer return',
        mode: payload.mode || 'FULL',
        items: payload.items,
      }),
    onSuccess: () => {
      toast.success('Sale refunded — stock & totals updated');
      invalidateAfterSaleChange(qc);
      setDetailId(null);
      void refetch();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) =>
      api.post(`/sales/${id}/void`, { reason: 'Mistake — deleted by user' }),
    onSuccess: () => {
      toast.success('Sale deleted — inventory restored');
      invalidateAfterSaleChange(qc);
      setDetailId(null);
      void refetch();
    },
    onError: (e) => toast.error(getErrorMessage(e) || 'Could not delete sale'),
  });

  const rows = data?.data || [];

  return (
    <PageShell
      title="Sales"
      description={
        canReverseSales
          ? 'Filter, open details, refund (full/partial), print & share'
          : 'Filter & print receipts (refund/delete: managers only)'
      }
      action={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Link to="/app/pos">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Record sale (POS)
            </Button>
          </Link>
        </div>
      }
    >
      {printId && (
        <PrintShareDialog
          open={!!printId}
          onClose={() => {
            setPrintId(null);
            setAutoPrint(false);
          }}
          type="receipt"
          id={printId}
          autoPrint={autoPrint}
        />
      )}

      <Card>
        <CardContent className="p-3 flex flex-wrap gap-2 items-end">
          <div className="min-w-[8rem] flex-1">
            <label className="text-[10px] text-muted-foreground">Search</label>
            <Input
              className="h-9"
              placeholder="Sale # or customer"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">From</label>
            <Input className="h-9" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">To</label>
            <Input className="h-9" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Status</label>
            <select
              className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="RETURNED">Returned</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-12 rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <p className="text-muted-foreground">No sales match your filters.</p>
            <Link to="/app/pos">
              <Button>
                <Plus className="h-4 w-4 mr-1" />
                Open POS
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={['Sale #', 'Customer', 'Total', 'Payment', 'Date', 'Actions']}
          rows={rows.map(
            (s: {
              id: string;
              saleNo: string;
              total: number;
              paymentStatus: string;
              status: string;
              saleDate: string;
              customer?: { firstName?: string; lastName?: string; businessName?: string };
            }) => {
              const active =
                s.status !== 'RETURNED' &&
                s.status !== 'CANCELLED' &&
                s.paymentStatus !== 'REFUNDED' &&
                s.paymentStatus !== 'VOID';
              return [
                <button
                  key="n"
                  type="button"
                  className="font-mono text-xs font-medium text-primary hover:underline"
                  onClick={() => setDetailId(s.id)}
                >
                  {s.saleNo}
                </button>,
                s.customer?.businessName ||
                  `${s.customer?.firstName || ''} ${s.customer?.lastName || ''}`.trim() ||
                  'Walk-in',
                formatCurrency(Number(s.total)),
                <div key="p" className="flex gap-1 flex-wrap">
                  <Badge
                    variant={
                      s.paymentStatus === 'PAID'
                        ? 'success'
                        : s.paymentStatus === 'REFUNDED' || s.paymentStatus === 'VOID'
                          ? 'destructive'
                          : 'warning'
                    }
                  >
                    {s.paymentStatus}
                  </Badge>
                </div>,
                formatDate(s.saleDate),
                <div key="a" className="flex gap-1 flex-wrap items-center max-w-[280px]">
                  <Button size="sm" variant="outline" onClick={() => setDetailId(s.id)}>
                    Open
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    title="Print"
                    onClick={() => {
                      setAutoPrint(true);
                      setPrintId(s.id);
                    }}
                  >
                    <Printer className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setAutoPrint(false);
                      setPrintId(s.id);
                    }}
                  >
                    <Share2 className="h-3.5 w-3.5" />
                  </Button>
                  {active && canReverseSales && (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={refund.isPending}
                      onClick={() => {
                        if (window.confirm(`Full refund ${s.saleNo}?`)) {
                          refund.mutate({ id: s.id, mode: 'FULL' });
                        }
                      }}
                    >
                      Refund
                    </Button>
                  )}
                </div>,
              ];
            }
          )}
        />
      )}

      {detailId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4">
          <div className="w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-border bg-card shadow-elevated">
            <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-border bg-card px-4 py-3">
              <h2 className="font-bold text-base">Sale detail</h2>
              <Button size="sm" variant="ghost" onClick={() => setDetailId(null)}>
                Close
              </Button>
            </div>
            <div className="p-4 space-y-3">
              {detailLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
              {detail && (
                <>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <Badge variant="secondary" className="font-mono">
                      {detail.saleNo}
                    </Badge>
                    <Badge>{detail.paymentStatus}</Badge>
                    <span className="text-muted-foreground text-xs">
                      {detail.saleDate ? new Date(detail.saleDate).toLocaleString() : ''}
                    </span>
                  </div>
                  <p className="text-lg font-bold tabular-nums">{formatCurrency(Number(detail.total))}</p>
                  <p className="text-xs text-muted-foreground">
                    Customer:{' '}
                    {detail.customer?.businessName ||
                      `${detail.customer?.firstName || ''} ${detail.customer?.lastName || ''}`.trim() ||
                      'Walk-in'}
                    {detail.cashier
                      ? ` · Cashier ${detail.cashier.firstName} ${detail.cashier.lastName}`
                      : ''}
                  </p>
                  <div className="rounded-xl border border-border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 text-left">
                        <tr>
                          <th className="p-2">Item</th>
                          <th className="p-2 text-right">Qty</th>
                          <th className="p-2 text-right">Total</th>
                          {canReverseSales && refundMode === 'PARTIAL' && (
                            <th className="p-2 text-right">Return</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.items || []).map(
                          (it: {
                            id: string;
                            productName: string;
                            quantity: number;
                            total: number;
                          }) => (
                            <tr key={it.id} className="border-t border-border/60">
                              <td className="p-2">{it.productName}</td>
                              <td className="p-2 text-right tabular-nums">{Number(it.quantity)}</td>
                              <td className="p-2 text-right tabular-nums">
                                {formatCurrency(Number(it.total))}
                              </td>
                              {canReverseSales && refundMode === 'PARTIAL' && (
                                <td className="p-2 text-right">
                                  <Input
                                    className="h-8 w-16 ml-auto text-xs"
                                    type="number"
                                    min={0}
                                    max={Number(it.quantity)}
                                    value={partialQty[it.id] || ''}
                                    onChange={(e) =>
                                      setPartialQty((p) => ({ ...p, [it.id]: e.target.value }))
                                    }
                                  />
                                </td>
                              )}
                            </tr>
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAutoPrint(true);
                        setPrintId(detail.id);
                      }}
                    >
                      <Printer className="h-3.5 w-3.5" /> Print
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setAutoPrint(false);
                        setPrintId(detail.id);
                      }}
                    >
                      <Share2 className="h-3.5 w-3.5" /> Share
                    </Button>
                    {canReverseSales &&
                      detail.status !== 'RETURNED' &&
                      detail.paymentStatus !== 'REFUNDED' && (
                        <>
                          <Button
                            size="sm"
                            variant={refundMode === 'FULL' ? 'default' : 'outline'}
                            onClick={() => setRefundMode('FULL')}
                          >
                            Full refund
                          </Button>
                          <Button
                            size="sm"
                            variant={refundMode === 'PARTIAL' ? 'default' : 'outline'}
                            onClick={() => setRefundMode('PARTIAL')}
                          >
                            Partial
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            loading={refund.isPending}
                            onClick={() => {
                              if (refundMode === 'FULL') {
                                if (window.confirm(`Full refund ${detail.saleNo}?`)) {
                                  refund.mutate({ id: detail.id, mode: 'FULL' });
                                }
                                return;
                              }
                              const items = (detail.items || [])
                                .map((it: { id: string; quantity: number }) => ({
                                  saleItemId: it.id,
                                  quantity: Number(partialQty[it.id] || 0),
                                }))
                                .filter((x: { quantity: number }) => x.quantity > 0);
                              if (!items.length) {
                                toast.error('Enter return quantities');
                                return;
                              }
                              refund.mutate({ id: detail.id, mode: 'PARTIAL', items });
                            }}
                          >
                            Confirm refund
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            loading={remove.isPending}
                            onClick={() => {
                              if (window.confirm(`Delete sale ${detail.saleNo}?`)) {
                                remove.mutate(detail.id);
                              }
                            }}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}

// ════════════════════ CUSTOMERS ════════════════════
export function CustomersPage() {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    creditLimit: '',
  });
  const [show, setShow] = useState(false);
  const [pickingContact, setPickingContact] = useState(false);
  const qc = useQueryClient();
  const showContactPicker = canPickDeviceContact() || Capacitor.isNativePlatform();

  const { data } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => (await api.get('/customers', { params: { limit: 50 } })).data,
  });
  const create = useMutation({
    mutationFn: async () => {
      const payload = {
        firstName: form.firstName.trim() || null,
        lastName: form.lastName.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        creditLimit: form.creditLimit ? parseFloat(form.creditLimit) : 0,
      };
      if (!payload.firstName && !payload.lastName && !payload.phone && !payload.email) {
        throw new Error('Enter a name, phone, or email');
      }
      return api.post('/customers', payload);
    },
    onSuccess: () => {
      toast.success('Customer created');
      setShow(false);
      setForm({ firstName: '', lastName: '', phone: '', email: '', creditLimit: '' });
      qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const fillFromContacts = async () => {
    setPickingContact(true);
    try {
      const picked = await pickDeviceContact();
      if (!picked) return;
      setForm((prev) => ({
        ...prev,
        firstName: picked.firstName || prev.firstName,
        lastName: picked.lastName || prev.lastName,
        phone: picked.phone || prev.phone,
        email: picked.email || prev.email,
      }));
      toast.success(
        picked.displayName
          ? `Filled from contact: ${picked.displayName}`
          : 'Contact details filled in'
      );
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setPickingContact(false);
    }
  };

  return (
    <PageShell
      title="Customers"
      description="Call, message, and track balances"
      action={
        <Button onClick={() => setShow((v) => !v)} className="rounded-xl shadow-sm">
          <Plus className="h-4 w-4" /> Add
        </Button>
      }
    >
      {show && (
        <Card>
          <CardContent className="pt-5 space-y-3">
            {showContactPicker && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={pickingContact}
                  onClick={() => void fillFromContacts()}
                >
                  <Contact className="h-4 w-4" />
                  Pick from contacts
                </Button>
                <p className="text-xs text-muted-foreground">
                  Auto-fill name, phone &amp; email from your phonebook
                </p>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Input
                placeholder="First name"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
              <Input
                placeholder="Last name"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
              <div className="flex gap-1.5">
                <Input
                  className="flex-1 min-w-0"
                  placeholder="Phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  inputMode="tel"
                  autoComplete="tel"
                />
                {showContactPicker && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    title="Pick phone from contacts"
                    loading={pickingContact}
                    onClick={() => void fillFromContacts()}
                  >
                    <Contact className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <Input
                placeholder="Email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                inputMode="email"
                autoComplete="email"
              />
              <Input
                type="number"
                min={0}
                placeholder="Credit limit (0 = none)"
                value={form.creditLimit}
                onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
              />
              <Button onClick={() => create.mutate()} loading={create.isPending}>
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {/* Mobile: modern contact cards */}
      <div className="space-y-2 sm:hidden">
        {(data?.data || []).length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No customers yet — add your first one
            </CardContent>
          </Card>
        )}
        {(data?.data || []).map(
          (c: {
            id?: string;
            code: string;
            firstName?: string;
            lastName?: string;
            businessName?: string;
            phone?: string;
            email?: string;
            balance: number;
            creditLimit?: number;
            loyaltyPoints: number;
          }) => {
            const name =
              c.businessName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Customer';
            const bal = Number(c.balance || 0);
            const initial = name.slice(0, 1).toUpperCase();
            return (
              <Card key={c.id || c.code} className="border-border/60 shadow-soft">
                <CardContent className="pt-3.5 pb-3 space-y-2.5">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/20 to-accent/15 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                      {initial}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate">{name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{c.code}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px]">
                        <span className={bal > 0 ? 'font-semibold text-warning' : 'text-muted-foreground'}>
                          Bal {formatCurrency(bal)}
                        </span>
                        <span className="text-muted-foreground">{c.loyaltyPoints ?? 0} pts</span>
                      </div>
                    </div>
                  </div>
                  <PhoneActions
                    phone={c.phone}
                    messageBody={
                      bal > 0
                        ? `Hi ${name}, reminder: your outstanding balance is ${formatCurrency(bal)}. `
                        : `Hi ${name}, `
                    }
                  />
                </CardContent>
              </Card>
            );
          }
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block">
        <DataTable
          columns={['Code', 'Name', 'Phone', 'Email', 'Balance', 'Credit limit', 'Points']}
          rows={(data?.data || []).map(
            (c: {
              code: string;
              firstName?: string;
              lastName?: string;
              businessName?: string;
              phone?: string;
              email?: string;
              balance: number;
              creditLimit?: number;
              loyaltyPoints: number;
            }) => {
              const name =
                c.businessName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Customer';
              const bal = Number(c.balance || 0);
              const limit = Number(c.creditLimit || 0);
              return [
                c.code,
                name,
                <PhoneActions
                  key={`phone-${c.code}`}
                  phone={c.phone}
                  messageBody={
                    bal > 0
                      ? `Hi ${name}, reminder: your outstanding balance is ${formatCurrency(bal)}. `
                      : `Hi ${name}, `
                  }
                />,
                c.email || '—',
                <span key="bal" className={bal > 0 ? 'font-semibold text-warning money-value' : 'money-value'}>
                  {formatCurrency(bal)}
                </span>,
                limit > 0 ? formatCurrency(limit) : '—',
                String(c.loyaltyPoints ?? 0),
              ];
            }
          )}
        />
      </div>
    </PageShell>
  );
}

// ════════════════════ SUPPLIERS ════════════════════
export function SuppliersPage() {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', contactPerson: '' });
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get('/suppliers')).data,
  });
  const create = useMutation({
    mutationFn: async () => api.post('/suppliers', form),
    onSuccess: () => {
      toast.success('Supplier created');
      setShow(false);
      qc.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <PageShell
      title="Suppliers"
      description="Vendor management"
      action={
        <Button onClick={() => setShow((v) => !v)}>
          <Plus className="h-4 w-4" /> Add supplier
        </Button>
      }
    >
      {show && (
        <Card>
          <CardContent className="pt-5 grid gap-3 sm:grid-cols-5">
            <Input placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="Contact" value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
            <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!form.name}>
              Save
            </Button>
          </CardContent>
        </Card>
      )}
      <DataTable
        columns={['Code', 'Name', 'Email', 'Phone', 'Balance']}
        rows={(data?.data || []).map((s: { code: string; name: string; email?: string; phone?: string; balance: number }) => [
          s.code,
          s.name,
          s.email || '—',
          <PhoneActions key={`sup-phone-${s.code}`} phone={s.phone} messageBody={`Hi ${s.name}, `} />,
          formatCurrency(Number(s.balance)),
        ])}
      />
    </PageShell>
  );
}

// ════════════════════ PURCHASES ════════════════════
export function PurchasesPage() {
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('10');
  const [cost, setCost] = useState('5');

  const { data } = useQuery({
    queryKey: ['purchases'],
    queryFn: async () => (await api.get('/purchases')).data,
  });
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get('/suppliers')).data,
  });
  const { data: products } = useQuery({
    queryKey: ['products-mini'],
    queryFn: async () => (await api.get('/products', { params: { limit: 100 } })).data,
  });
  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => (await api.get('/warehouses')).data,
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!supplierId) throw new Error('Select a supplier');
      if (!productId) throw new Error('Select a product');
      const quantity = parseFloat(qty);
      const unitCost = parseFloat(cost);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Enter a valid quantity');
      if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error('Enter a valid unit cost');
      return api.post('/purchases', {
        supplierId,
        items: [{ productId, quantity, unitCost }],
      });
    },
    onSuccess: () => {
      toast.success('Purchase order created');
      setShow(false);
      qc.invalidateQueries({ queryKey: ['purchases'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const receive = useMutation({
    mutationFn: async (po: { id: string; orderNo?: string; items?: Array<{ id: string; quantity: number; receivedQty: number }> }) => {
      // Prefer default warehouse, then first available
      const whList = (warehouses?.data || []) as Array<{ id: string; isDefault?: boolean; name?: string }>;
      const wh =
        whList.find((w) => w.isDefault)?.id ||
        whList[0]?.id ||
        (await api.get('/warehouses')).data?.data?.[0]?.id;
      if (!wh) throw new Error('No warehouse configured. Create one under Settings first.');

      // List payload may omit items â€” always load full PO when needed
      let lines = Array.isArray(po.items) ? po.items : [];
      if (!lines.length) {
        const full = await api.get(`/purchases/${po.id}`);
        lines = full.data?.data?.items || [];
      }
      if (!lines.length) throw new Error('This purchase order has no line items');

      const items = lines
        .map((i) => ({
          itemId: i.id,
          receivedQty: Math.max(0, Number(i.quantity) - Number(i.receivedQty || 0)),
        }))
        .filter((i) => i.receivedQty > 0);

      if (!items.length) throw new Error('Already fully received');

      return api.post(`/purchases/${po.id}/receive`, {
        warehouseId: wh,
        items,
      });
    },
    onSuccess: (res) => {
      const status = res.data?.data?.status;
      toast.success(
        status === 'RECEIVED'
          ? 'Goods fully received â€” stock updated'
          : 'Partial receipt recorded â€” stock updated'
      );
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock-levels'] });
      qc.invalidateQueries({ queryKey: ['pos-products'] });
    },
    onError: (e) => toast.error(getErrorMessage(e) || 'Could not receive goods'),
  });

  return (
    <PageShell
      title="Purchases"
      description="Purchase orders & goods receipt (updates stock)"
      action={
        <Button onClick={() => setShow((v) => !v)}>
          <Plus className="h-4 w-4" /> New PO
        </Button>
      }
    >
      {show && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create purchase order</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <select className="h-10 rounded-lg border border-input bg-background px-3 text-sm" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select supplier</option>
              {(suppliers?.data || []).map((s: { id: string; name: string }) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select className="h-10 rounded-lg border border-input bg-background px-3 text-sm" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Select product</option>
              {(products?.data || []).map((p: { id: string; name: string; sku: string }) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku})
                </option>
              ))}
            </select>
            <Input type="number" placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />
            <Input type="number" placeholder="Unit cost" value={cost} onChange={(e) => setCost(e.target.value)} />
            <Button loading={create.isPending} disabled={!supplierId || !productId} onClick={() => create.mutate()}>
              Create PO
            </Button>
          </CardContent>
        </Card>
      )}
      <DataTable
        columns={['PO #', 'Supplier', 'Total', 'Status', 'Created', 'Actions']}
        rows={(data?.data || []).map(
          (p: {
            id: string;
            orderNo: string;
            total: number;
            status: string;
            createdAt: string;
            supplier?: { name: string };
            items?: Array<{ id: string; quantity: number; receivedQty: number }>;
          }) => [
            p.orderNo,
            p.supplier?.name || 'â€”',
            formatCurrency(Number(p.total)),
            <Badge key="s" variant={p.status === 'RECEIVED' ? 'success' : 'secondary'}>
              {p.status}
            </Badge>,
            formatDate(p.createdAt),
            p.status !== 'RECEIVED' && p.status !== 'CANCELLED' ? (
              <Button key="r" size="sm" variant="outline" loading={receive.isPending} onClick={() => receive.mutate(p as never)}>
                Receive
              </Button>
            ) : (
              'â€”'
            ),
          ]
        )}
      />
    </PageShell>
  );
}

function StockTransferForm() {
  const qc = useQueryClient();
  const [fromWh, setFromWh] = useState('');
  const [toWh, setToWh] = useState('');
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('1');

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => (await api.get('/warehouses')).data,
  });
  const { data: products } = useQuery({
    queryKey: ['products-mini'],
    queryFn: async () => (await api.get('/products', { params: { limit: 100 } })).data,
  });

  const transfer = useMutation({
    mutationFn: async () => {
      const q = parseFloat(qty);
      if (!fromWh || !toWh || !productId || !Number.isFinite(q) || q <= 0) {
        throw new Error('Select warehouses, product, and quantity');
      }
      if (fromWh === toWh) throw new Error('Warehouses must differ');
      return api.post('/stock/transfers', {
        fromWarehouseId: fromWh,
        toWarehouseId: toWh,
        items: [{ productId, quantity: q }],
      });
    },
    onSuccess: () => {
      toast.success('Stock transferred');
      qc.invalidateQueries({ queryKey: ['stock-levels'] });
      qc.invalidateQueries({ queryKey: ['stock-movements'] });
      setQty('1');
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const wh = (warehouses?.data || []) as Array<{ id: string; name: string }>;
  const prods = (products?.data || []) as Array<{ id: string; name: string }>;

  return (
    <div className="space-y-2">
      <select
        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
        value={fromWh}
        onChange={(e) => setFromWh(e.target.value)}
      >
        <option value="">From warehouse</option>
        {wh.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      <select
        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
        value={toWh}
        onChange={(e) => setToWh(e.target.value)}
      >
        <option value="">To warehouse</option>
        {wh.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      <select
        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
        value={productId}
        onChange={(e) => setProductId(e.target.value)}
      >
        <option value="">Product</option>
        {prods.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty" />
      <Button size="sm" loading={transfer.isPending} onClick={() => transfer.mutate()}>
        Transfer stock
      </Button>
    </div>
  );
}

// ════════════════════ INVENTORY ════════════════════
export function InventoryPage() {
  const qc = useQueryClient();
  const [adjProduct, setAdjProduct] = useState('');
  const [adjQty, setAdjQty] = useState('0');
  const [adjReason, setAdjReason] = useState('Stock count');
  const [supplierId, setSupplierId] = useState('');

  const { data: low } = useQuery({
    queryKey: ['low-stock'],
    queryFn: async () => (await api.get('/products/low-stock')).data.data,
  });
  const { data: stock } = useQuery({
    queryKey: ['stock-levels'],
    queryFn: async () => (await api.get('/stock')).data.data,
  });
  const { data: movements } = useQuery({
    queryKey: ['stock-movements'],
    queryFn: async () => (await api.get('/stock/movements', { params: { limit: 20 } })).data,
  });
  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => (await api.get('/warehouses')).data,
  });
  const { data: products } = useQuery({
    queryKey: ['products-mini'],
    queryFn: async () => (await api.get('/products', { params: { limit: 100 } })).data,
  });
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get('/suppliers', { params: { limit: 50 } })).data,
  });

  const adjust = useMutation({
    mutationFn: async () => {
      if (!adjProduct) throw new Error('Select a product');
      const qty = parseFloat(adjQty);
      if (!Number.isFinite(qty) || qty < 0) throw new Error('Enter a valid counted quantity');
      const whList = (warehouses?.data || []) as Array<{ id: string; isDefault?: boolean }>;
      const wh =
        whList.find((w) => w.isDefault)?.id ||
        whList[0]?.id ||
        (await api.get('/warehouses')).data?.data?.[0]?.id;
      if (!wh) throw new Error('No warehouse configured. Create one under Settings first.');
      return api.post('/stock/adjust', {
        warehouseId: wh,
        reason: adjReason,
        items: [{ productId: adjProduct, countedQty: qty }],
      });
    },
    onSuccess: () => {
      toast.success('Stock adjusted');
      qc.invalidateQueries({ queryKey: ['stock-levels'] });
      qc.invalidateQueries({ queryKey: ['low-stock'] });
      qc.invalidateQueries({ queryKey: ['stock-movements'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const draftFromLowStock = useMutation({
    mutationFn: async () => {
      if (!supplierId) throw new Error('Select a supplier for the reorder draft');
      return api.post('/purchases', {
        supplierId,
        status: 'DRAFT',
        fromLowStock: true,
        notes: 'Draft from low-stock list',
        items: [],
      });
    },
    onSuccess: (res) => {
      const po = res.data?.data;
      toast.success(po?.orderNo ? `Draft ${po.orderNo} created` : 'Purchase draft created');
      qc.invalidateQueries({ queryKey: ['purchases'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <PageShell title="Inventory" description="Stock levels, adjustments, movements & alerts">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock adjustment</CardTitle>
            <CardDescription>Set counted quantity (stock take)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <select className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" value={adjProduct} onChange={(e) => setAdjProduct(e.target.value)}>
              <option value="">Product</option>
              {(products?.data || []).map((p: { id: string; name: string }) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Input type="number" placeholder="Counted qty" value={adjQty} onChange={(e) => setAdjQty(e.target.value)} />
            <Input placeholder="Reason" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />
            <Button disabled={!adjProduct} loading={adjust.isPending} onClick={() => adjust.mutate()}>
              Apply adjustment
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock transfer</CardTitle>
            <CardDescription>Move stock between warehouses</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <StockTransferForm />
          </CardContent>
        </Card>

        <Card id="low-stock">
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Low stock alerts</CardTitle>
              <CardDescription>Create a purchase draft to restock</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[10rem]">
                <label className="text-xs text-muted-foreground">Supplier</label>
                <select
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  <option value="">Select supplier</option>
                  {((suppliers?.data || []) as Array<{ id: string; name: string }>).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={!low?.length}
                loading={draftFromLowStock.isPending}
                onClick={() => draftFromLowStock.mutate()}
              >
                Create reorder draft
              </Button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(low || []).map((p: { id: string; name: string; sku: string; stockQty: number; reorderLevel: number }) => (
                <div key={p.id} className="flex justify-between text-sm border-b border-border/50 pb-2">
                  <div>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.sku}</p>
                  </div>
                  <Badge variant="destructive">
                    {p.stockQty} / {p.reorderLevel}
                  </Badge>
                </div>
              ))}
              {!low?.length && <p className="text-sm text-muted-foreground">All stock healthy</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current stock by warehouse</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={['Product', 'SKU', 'Warehouse', 'Qty', 'Value']}
            rows={(stock || []).map(
              (s: {
                quantity: number;
                product: { name: string; sku: string; costPrice: number };
                warehouse: { name: string };
              }) => [
                s.product.name,
                s.product.sku,
                s.warehouse.name,
                String(Number(s.quantity)),
                formatCurrency(Number(s.quantity) * Number(s.product.costPrice)),
              ]
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent movements</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={['Date', 'Product', 'Type', 'Qty', 'Warehouse', 'Ref']}
            rows={(movements?.data || []).map(
              (m: {
                createdAt: string;
                type: string;
                quantity: number;
                reference?: string;
                product: { name: string };
                warehouse: { name: string };
              }) => [
                formatDate(m.createdAt),
                m.product.name,
                <Badge key="t" variant="outline">
                  {m.type}
                </Badge>,
                String(Number(m.quantity)),
                m.warehouse.name,
                m.reference || 'â€”',
              ]
            )}
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• INVOICES â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
type InvoiceLineDraft = {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
};

type InvoiceRow = {
  id: string;
  invoiceNo: string;
  total: number | string;
  paidAmount: number | string;
  subtotal?: number | string;
  taxAmount?: number | string;
  discountAmount?: number | string;
  paymentStatus: string;
  status: string;
  dueDate?: string | null;
  notes?: string | null;
  createdAt?: string;
  issuedAt?: string | null;
  currency?: string;
  customer?: {
    id?: string;
    firstName?: string;
    lastName?: string;
    businessName?: string;
    email?: string;
    phone?: string;
  } | null;
  items?: Array<{
    id: string;
    description: string;
    quantity: number | string;
    unitPrice: number | string;
    taxAmount: number | string;
    total: number | string;
  }>;
  payments?: Array<{
    id: string;
    amount: number | string;
    method: string;
    createdAt: string;
    reference?: string | null;
  }>;
  _count?: { items: number; payments: number };
};

function emptyLine(): InvoiceLineDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    description: '',
    quantity: '1',
    unitPrice: '',
    taxRate: '0',
  };
}

export function InvoicesPage() {
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [printId, setPrintId] = useState<string | null>(null);
  const [autoPrint, setAutoPrint] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Create form
  const [customerId, setCustomerId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [discount, setDiscount] = useState('');
  const [lines, setLines] = useState<InvoiceLineDraft[]>([
    { ...emptyLine(), description: 'Services' },
  ]);

  // Payment form (detail panel)
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'CASH' | 'CARD' | 'MOBILE_MONEY' | 'BANK_TRANSFER'>('CASH');
  const [payRef, setPayRef] = useState('');

  // From sale
  const [fromSaleId, setFromSaleId] = useState('');

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['invoices', search, statusFilter],
    queryFn: async () =>
      (
        await api.get('/invoices', {
          params: {
            limit: 50,
            search: search || undefined,
            paymentStatus: statusFilter || undefined,
            sortBy: 'createdAt',
            sortOrder: 'desc',
          },
        })
      ).data as { data: InvoiceRow[]; meta?: { total: number } },
  });

  const { data: summary } = useQuery({
    queryKey: ['invoices-summary'],
    queryFn: async () =>
      (await api.get('/invoices/summary')).data.data as {
        total: number;
        unpaid: number;
        partial: number;
        paid: number;
        voided: number;
        outstanding: number;
      },
  });

  const { data: customers } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => (await api.get('/customers', { params: { limit: 100 } })).data,
  });

  const { data: recentSales } = useQuery({
    queryKey: ['sales-for-invoice'],
    queryFn: async () =>
      (await api.get('/sales', { params: { limit: 30, sortBy: 'saleDate', sortOrder: 'desc' } })).data
        .data as Array<{ id: string; saleNo: string; total: number; customer?: { businessName?: string } }>,
  });

  const { data: detail, isLoading: loadingDetail } = useQuery({
    queryKey: ['invoice-detail', selectedId],
    enabled: !!selectedId,
    queryFn: async () => (await api.get(`/invoices/${selectedId}`)).data.data as InvoiceRow,
  });

  const linePreview = useMemo(() => {
    // Line prices are entered in display currency; convert to base for preview/formatCurrency
    let sub = 0;
    let tax = 0;
    for (const l of lines) {
      const qty = parseFloat(l.quantity) || 0;
      const price = parseMoneyToBase(l.unitPrice);
      const rate = parseFloat(l.taxRate) || 0;
      const lineSub = qty * price;
      sub += lineSub;
      tax += (lineSub * rate) / 100;
    }
    const disc = Math.max(0, parseMoneyToBase(discount));
    return { sub, tax, disc, total: Math.max(0, sub + tax - disc) };
  }, [lines, discount]);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['invoices'] });
    qc.invalidateQueries({ queryKey: ['invoices-summary'] });
    qc.invalidateQueries({ queryKey: ['invoice-detail'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const create = useMutation({
    mutationFn: async () => {
      const items = lines
        .filter((l) => l.description.trim())
        .map((l) => {
          const quantity = parseFloat(l.quantity) || 0;
          // Prices typed in display currency â†’ company base for API
          const unitPrice = parseMoneyToBase(l.unitPrice);
          const taxRate = parseFloat(l.taxRate) || 0;
          return {
            description: l.description.trim(),
            quantity,
            unitPrice,
            taxRate,
          };
        });
      if (!items.length) throw new Error('Add at least one line with a description');
      if (items.some((i) => i.quantity <= 0)) throw new Error('Quantity must be greater than 0');

      return api.post('/invoices', {
        customerId: customerId || null,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        notes: notes.trim() || null,
        discountAmount: Math.max(0, parseMoneyToBase(discount)),
        items,
      });
    },
    onSuccess: (res) => {
      toast.success(`Invoice ${res.data?.data?.invoiceNo || ''} created`);
      setShow(false);
      setLines([{ ...emptyLine(), description: 'Services' }]);
      setDiscount('');
      setNotes('');
      setDueDate('');
      setCustomerId('');
      refreshAll();
      if (res.data?.data?.id) setSelectedId(res.data.data.id);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const fromSale = useMutation({
    mutationFn: async (saleId: string) => api.post(`/invoices/from-sale/${saleId}`),
    onSuccess: (res) => {
      toast.success(`Invoice ${res.data?.data?.invoiceNo || ''} created from sale`);
      setFromSaleId('');
      refreshAll();
      if (res.data?.data?.id) setSelectedId(res.data.data.id);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const pay = useMutation({
    mutationFn: async () => {
      if (!selectedId || !detail) throw new Error('Select an invoice');
      const balance = Math.max(0, Number(detail.total) - Number(detail.paidAmount));
      const amount = parseFloat(payAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid payment amount');
      if (amount > balance + 0.001) throw new Error(`Amount exceeds balance (${balance.toFixed(2)})`);
      return api.post(`/invoices/${selectedId}/payments`, {
        amount,
        method: payMethod,
        reference: payRef.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success('Payment recorded');
      setPayAmount('');
      setPayRef('');
      refreshAll();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const voidInv = useMutation({
    mutationFn: async (id: string) =>
      api.post(`/invoices/${id}/void`, { reason: 'Voided from invoices screen' }),
    onSuccess: () => {
      toast.success('Invoice voided');
      refreshAll();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const removeInv = useMutation({
    mutationFn: async (id: string) => api.delete(`/invoices/${id}`),
    onSuccess: () => {
      toast.success('Invoice deleted');
      setSelectedId(null);
      refreshAll();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const rows = data?.data || [];
  const balanceOf = (inv: InvoiceRow) =>
    Math.max(0, Number(inv.total) - Number(inv.paidAmount));

  useEffect(() => {
    if (detail && selectedId === detail.id) {
      const bal = balanceOf(detail);
      if (!payAmount && bal > 0) setPayAmount(String(Math.round(bal * 10000) / 10000));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

  return (
    <PageShell
      title="Invoices"
      description="Create multi-line invoices, record payments, print/share PDFs, void mistakes"
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button size="sm" onClick={() => setShow((v) => !v)}>
            <Plus className="h-4 w-4" /> New invoice
          </Button>
        </div>
      }
    >
      {printId && (
        <PrintShareDialog
          open={!!printId}
          onClose={() => {
            setPrintId(null);
            setAutoPrint(false);
          }}
          type="invoice"
          id={printId}
          autoPrint={autoPrint}
        />
      )}

      {/* KPIs */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 min-w-0">
        {[
          { label: 'All invoices', value: summary?.total ?? 'â€”' },
          { label: 'Unpaid', value: summary?.unpaid ?? 'â€”', tone: 'text-warning' },
          { label: 'Partial', value: summary?.partial ?? 'â€”' },
          { label: 'Paid', value: summary?.paid ?? 'â€”', tone: 'text-success' },
          {
            label: 'Outstanding',
            value: summary ? formatCurrency(summary.outstanding) : 'â€”',
            tone: 'text-primary',
          },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-2.5 sm:p-3 shadow-sm min-w-0">
            <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{k.label}</p>
            <p className={`text-sm sm:text-lg font-bold tabular-nums mt-0.5 truncate ${k.tone || ''}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Create form */}
      {show && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">New invoice</CardTitle>
            <CardDescription>Add multiple line items, tax %, discount, due date</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Customer</label>
                <select
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  <option value="">Walk-in / no customer</option>
                  {(customers?.data || []).map(
                    (c: {
                      id: string;
                      firstName?: string;
                      lastName?: string;
                      businessName?: string;
                      code?: string;
                    }) => (
                      <option key={c.id} value={c.id}>
                        {c.businessName ||
                          `${c.firstName || ''} ${c.lastName || ''}`.trim()}
                        {c.code ? ` (${c.code})` : ''}
                      </option>
                    )
                  )}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Due date</label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Invoice discount</label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Notes</label>
                <Input
                  placeholder="Optional notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Line items</p>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => setLines((prev) => [...prev, emptyLine()])}
                >
                  <Plus className="h-3.5 w-3.5" /> Add line
                </Button>
              </div>
              <div className="space-y-2">
                {lines.map((line, idx) => (
                  <div
                    key={line.key}
                    className="grid gap-2 sm:grid-cols-12 items-end rounded-xl border border-border p-2 bg-muted/20"
                  >
                    <div className="sm:col-span-5 space-y-1">
                      <label className="text-[11px] text-muted-foreground">Description</label>
                      <Input
                        value={line.description}
                        placeholder="Item or service"
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, description: e.target.value } : l
                            )
                          )
                        }
                      />
                    </div>
                    <div className="sm:col-span-2 space-y-1">
                      <label className="text-[11px] text-muted-foreground">Qty</label>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={line.quantity}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, quantity: e.target.value } : l
                            )
                          )
                        }
                      />
                    </div>
                    <div className="sm:col-span-2 space-y-1">
                      <label className="text-[11px] text-muted-foreground">
                        Unit price ({displayCurrencyCode()})
                      </label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, unitPrice: e.target.value } : l
                            )
                          )
                        }
                      />
                    </div>
                    <div className="sm:col-span-2 space-y-1">
                      <label className="text-[11px] text-muted-foreground">Tax %</label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.taxRate}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, taxRate: e.target.value } : l
                            )
                          )
                        }
                      />
                    </div>
                    <div className="sm:col-span-1 flex justify-end pb-0.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        disabled={lines.length <= 1}
                        onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        âœ•
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
              <div className="text-sm space-y-0.5">
                <p className="text-muted-foreground">
                  Subtotal {formatCurrency(linePreview.sub)} Â· Tax {formatCurrency(linePreview.tax)}
                  {linePreview.disc > 0 ? ` Â· Discount âˆ’${formatCurrency(linePreview.disc)}` : ''}
                </p>
                <p className="text-lg font-bold text-primary tabular-nums">
                  Total {formatCurrency(linePreview.total)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShow(false)}>
                  Cancel
                </Button>
                <Button loading={create.isPending} onClick={() => create.mutate()}>
                  Create invoice
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create from sale */}
      <Card>
        <CardContent className="pt-4 flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1 space-y-1">
            <label className="text-xs text-muted-foreground">Create invoice from a sale</label>
            <select
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
              value={fromSaleId}
              onChange={(e) => setFromSaleId(e.target.value)}
            >
              <option value="">Select a recent saleâ€¦</option>
              {(recentSales || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.saleNo} Â· {formatCurrency(Number(s.total))}
                  {s.customer?.businessName ? ` Â· ${s.customer.businessName}` : ''}
                </option>
              ))}
            </select>
          </div>
          <Button
            loading={fromSale.isPending}
            disabled={!fromSaleId}
            onClick={() => fromSale.mutate(fromSaleId)}
          >
            Invoice from sale
          </Button>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          className="sm:max-w-xs"
          placeholder="Search invoice #, customer, notesâ€¦"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm sm:w-44"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All payment status</option>
          <option value="UNPAID">Unpaid</option>
          <option value="PARTIAL">Partial</option>
          <option value="PAID">Paid</option>
          <option value="VOID">Void</option>
        </select>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        {/* List */}
        <div className="xl:col-span-3 space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading invoicesâ€¦</p>
          ) : rows.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center space-y-2">
                <p className="text-muted-foreground">No invoices yet</p>
                <Button onClick={() => setShow(true)}>
                  <Plus className="h-4 w-4" /> Create first invoice
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {rows.map((inv) => {
                const bal = balanceOf(inv);
                const active =
                  inv.paymentStatus !== 'PAID' &&
                  inv.paymentStatus !== 'VOID' &&
                  inv.status !== 'CANCELLED';
                return (
                  <button
                    key={inv.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(inv.id);
                      setPayAmount('');
                    }}
                    className={`w-full text-left rounded-xl border p-3 transition-colors ${
                      selectedId === inv.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/40 bg-card'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold font-mono text-sm">{inv.invoiceNo}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {inv.customer?.businessName ||
                            `${inv.customer?.firstName || ''} ${inv.customer?.lastName || ''}`.trim() ||
                            'No customer'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {inv.issuedAt || inv.createdAt
                            ? formatDate((inv.issuedAt || inv.createdAt) as string)
                            : 'â€”'}
                          {inv.dueDate ? ` Â· Due ${formatDate(inv.dueDate)}` : ''}
                          {inv._count?.items != null ? ` Â· ${inv._count.items} lines` : ''}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold tabular-nums">{formatCurrency(Number(inv.total))}</p>
                        <Badge
                          variant={
                            inv.paymentStatus === 'PAID'
                              ? 'success'
                              : inv.paymentStatus === 'VOID'
                                ? 'destructive'
                                : inv.paymentStatus === 'PARTIAL'
                                  ? 'warning'
                                  : 'secondary'
                          }
                        >
                          {inv.paymentStatus}
                        </Badge>
                        {active && bal > 0 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Due {formatCurrency(bal)}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="xl:col-span-2">
          <Card className="sticky top-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {detail?.invoiceNo || 'Invoice detail'}
              </CardTitle>
              <CardDescription>
                {selectedId
                  ? 'View lines, record payment, print or void'
                  : 'Select an invoice from the list'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedId && (
                <p className="text-sm text-muted-foreground py-10 text-center">
                  Tap an invoice to manage it
                </p>
              )}
              {selectedId && loadingDetail && (
                <p className="text-sm text-muted-foreground">Loadingâ€¦</p>
              )}
              {detail && (
                <>
                  <div className="flex flex-wrap gap-2 items-center">
                    <Badge
                      variant={
                        detail.paymentStatus === 'PAID'
                          ? 'success'
                          : detail.paymentStatus === 'VOID'
                            ? 'destructive'
                            : 'warning'
                      }
                    >
                      {detail.paymentStatus}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{detail.status}</span>
                  </div>

                  <div className="rounded-lg border border-border p-3 text-sm space-y-1">
                    <p>
                      <span className="text-muted-foreground">Customer: </span>
                      <strong>
                        {detail.customer?.businessName ||
                          `${detail.customer?.firstName || ''} ${detail.customer?.lastName || ''}`.trim() ||
                          'â€”'}
                      </strong>
                    </p>
                    {detail.customer?.phone && (
                      <div className="pt-0.5">
                        <PhoneActions
                          phone={detail.customer.phone}
                          messageBody={`Hi ${
                            detail.customer?.businessName ||
                            `${detail.customer?.firstName || ''} ${detail.customer?.lastName || ''}`.trim() ||
                            ''
                          }, regarding invoice ${detail.invoiceNo || ''}`.trim()}
                        />
                      </div>
                    )}
                    {detail.customer?.email && (
                      <p className="text-muted-foreground text-xs">{detail.customer.email}</p>
                    )}
                    {detail.dueDate && (
                      <p>
                        <span className="text-muted-foreground">Due: </span>
                        {formatDate(detail.dueDate)}
                      </p>
                    )}
                    {detail.notes && (
                      <p className="text-xs text-muted-foreground pt-1">{detail.notes}</p>
                    )}
                  </div>

                  <div className="table-scroll rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/40 text-left text-muted-foreground">
                          <th className="px-2 py-2">Item</th>
                          <th className="px-2 py-2 text-right">Qty</th>
                          <th className="px-2 py-2 text-right">Price</th>
                          <th className="px-2 py-2 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.items || []).map((it) => (
                          <tr key={it.id} className="border-t border-border/60">
                            <td className="px-2 py-2">{it.description}</td>
                            <td className="px-2 py-2 text-right tabular-nums">
                              {Number(it.quantity)}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">
                              {formatCurrency(Number(it.unitPrice))}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums font-medium">
                              {formatCurrency(Number(it.total))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="text-sm space-y-1 border-t border-border pt-2">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Subtotal</span>
                      <span>{formatCurrency(Number(detail.subtotal || 0))}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Tax</span>
                      <span>{formatCurrency(Number(detail.taxAmount || 0))}</span>
                    </div>
                    {Number(detail.discountAmount || 0) > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>Discount</span>
                        <span>âˆ’{formatCurrency(Number(detail.discountAmount))}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-base">
                      <span>Total</span>
                      <span className="text-primary">{formatCurrency(Number(detail.total))}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Paid</span>
                      <span>{formatCurrency(Number(detail.paidAmount))}</span>
                    </div>
                    <div className="flex justify-between font-semibold">
                      <span>Balance</span>
                      <span>{formatCurrency(balanceOf(detail))}</span>
                    </div>
                  </div>

                  {(detail.payments || []).length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Payments</p>
                      <div className="space-y-1 max-h-28 overflow-y-auto">
                        {detail.payments!.map((p) => (
                          <div
                            key={p.id}
                            className="flex justify-between text-xs rounded border border-border px-2 py-1"
                          >
                            <span>
                              {p.method.replace(/_/g, ' ')}
                              {p.reference ? ` Â· ${p.reference}` : ''}
                            </span>
                            <span className="tabular-nums font-medium">
                              {formatCurrency(Number(p.amount))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAutoPrint(true);
                        setPrintId(detail.id);
                      }}
                    >
                      <Printer className="h-3.5 w-3.5" /> Print
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setAutoPrint(false);
                        setPrintId(detail.id);
                      }}
                    >
                      <Share2 className="h-3.5 w-3.5" /> PDF / Share
                    </Button>
                  </div>

                  {detail.paymentStatus !== 'PAID' &&
                    detail.paymentStatus !== 'VOID' &&
                    detail.status !== 'CANCELLED' && (
                      <div className="rounded-xl border border-border p-3 space-y-2 bg-muted/20">
                        <p className="text-sm font-medium">Record payment</p>
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="Amount"
                            value={payAmount}
                            onChange={(e) => setPayAmount(e.target.value)}
                          />
                          <select
                            className="h-10 rounded-lg border border-input bg-background px-2 text-sm"
                            value={payMethod}
                            onChange={(e) =>
                              setPayMethod(e.target.value as typeof payMethod)
                            }
                          >
                            <option value="CASH">Cash</option>
                            <option value="CARD">Card</option>
                            <option value="MOBILE_MONEY">Mobile money</option>
                            <option value="BANK_TRANSFER">Bank transfer</option>
                          </select>
                        </div>
                        <Input
                          placeholder="Reference (optional)"
                          value={payRef}
                          onChange={(e) => setPayRef(e.target.value)}
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" loading={pay.isPending} onClick={() => pay.mutate()}>
                            Pay
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setPayAmount(String(Math.round(balanceOf(detail) * 10000) / 10000))
                            }
                          >
                            Full balance
                          </Button>
                        </div>
                      </div>
                    )}

                  {detail.paymentStatus !== 'PAID' && detail.paymentStatus !== 'VOID' && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="destructive"
                        loading={voidInv.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Void invoice ${detail.invoiceNo}? It will be marked cancelled.`
                            )
                          ) {
                            voidInv.mutate(detail.id);
                          }
                        }}
                      >
                        Void
                      </Button>
                      {Number(detail.paidAmount) <= 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={removeInv.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete invoice ${detail.invoiceNo}? This cannot be undone.`
                              )
                            ) {
                              removeInv.mutate(detail.id);
                            }
                          }}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• HOSPITAL â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
export function HospitalPage() {
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', gender: 'UNKNOWN' });
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['patients'],
    queryFn: async () => (await api.get('/patients')).data,
  });
  const create = useMutation({
    mutationFn: async () => api.post('/patients', form),
    onSuccess: () => {
      toast.success('Patient registered');
      setForm({ firstName: '', lastName: '', phone: '', gender: 'UNKNOWN' });
      qc.invalidateQueries({ queryKey: ['patients'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <PageShell title="Hospital / Clinic" description="Patient registration & EMR access">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Register patient</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-5">
          <Input placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          <Input placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <select className="h-10 rounded-lg border border-input bg-background px-3 text-sm" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
            <option value="UNKNOWN">Gender</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
            <option value="OTHER">Other</option>
          </select>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!form.firstName || !form.lastName}>
            Register
          </Button>
        </CardContent>
      </Card>
      <DataTable
        columns={['Patient #', 'Name', 'Phone', 'Type', 'Blood']}
        rows={(data?.data || []).map((p: { patientNo: string; firstName: string; lastName: string; phone?: string; type: string; bloodGroup?: string }) => [
          p.patientNo,
          `${p.firstName} ${p.lastName}`,
          p.phone || 'â€”',
          <Badge key="t" variant="secondary">
            {p.type}
          </Badge>,
          p.bloodGroup || 'â€”',
        ])}
      />
    </PageShell>
  );
}

export function PharmacyPage() {
  const { data } = useQuery({
    queryKey: ['drugs'],
    queryFn: async () => (await api.get('/products', { params: { type: 'DRUG', limit: 50 } })).data,
  });
  return (
    <PageShell title="Pharmacy" description="Drug inventory, Rx flags & expiry tracking">
      <DataTable
        columns={['Drug', 'SKU', 'Price', 'Stock', 'Rx']}
        rows={(data?.data || []).map((p: { name: string; sku: string; sellingPrice: number; stockQty?: number; requiresPrescription?: boolean }) => [
          p.name,
          p.sku,
          formatCurrency(Number(p.sellingPrice)),
          String(p.stockQty ?? 0),
          p.requiresPrescription ? (
            <Badge key="rx" variant="warning">
              Rx
            </Badge>
          ) : (
            'â€”'
          ),
        ])}
      />
    </PageShell>
  );
}

export function LaboratoryPage() {
  const { data } = useQuery({
    queryKey: ['lab-orders'],
    queryFn: async () => (await api.get('/lab-orders')).data,
  });
  return (
    <PageShell title="Laboratory" description="Test orders & results">
      <DataTable
        columns={['Order #', 'Patient', 'Status', 'Priority', 'Ordered']}
        rows={(data?.data || []).map(
          (o: { orderNo: string; status: string; priority: string; orderedAt: string; patient?: { firstName: string; lastName: string } }) => [
            o.orderNo,
            o.patient ? `${o.patient.firstName} ${o.patient.lastName}` : 'â€”',
            <Badge key="s">{o.status}</Badge>,
            o.priority,
            formatDate(o.orderedAt),
          ]
        )}
      />
    </PageShell>
  );
}

export function AccountingPage() {
  const qc = useQueryClient();
  const [expForm, setExpForm] = useState({
    category: 'other',
    description: '',
    amount: '',
    expenseDate: new Date().toISOString().slice(0, 10),
  });
  const { data } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await api.get('/accounts')).data,
  });
  const { data: profit } = useQuery({
    queryKey: ['profit-report'],
    queryFn: async () => (await api.get('/reports/profit')).data.data,
  });
  const { data: expenses } = useQuery({
    queryKey: ['expenses'],
    queryFn: async () => (await api.get('/expenses')).data.data as {
      total: number;
      rows: Array<{
        id: string;
        category: string;
        description?: string;
        amount: number;
        expenseDate: string;
      }>;
    },
  });
  const addExpense = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(expForm.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid amount');
      return api.post('/expenses', {
        category: expForm.category,
        description: expForm.description || null,
        amount,
        expenseDate: expForm.expenseDate,
      });
    },
    onSuccess: () => {
      toast.success('Expense recorded');
      setExpForm((f) => ({ ...f, description: '', amount: '' }));
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['profit-report'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const delExpense = useMutation({
    mutationFn: async (id: string) => api.delete(`/expenses/${id}`),
    onSuccess: () => {
      toast.success('Expense removed');
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['profit-report'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <PageShell title="Accounting" description="P&L, expenses, and chart of accounts">
      {profit && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {[
            { label: 'Gross sales', value: profit.revenue },
            { label: 'Net sales', value: profit.netRevenue ?? profit.revenue },
            { label: 'COGS', value: profit.cogs },
            { label: 'Gross Profit', value: profit.grossProfit },
            { label: 'Expenses', value: profit.expenses ?? expenses?.total ?? 0 },
            { label: 'Net Profit', value: profit.netProfit ?? profit.grossProfit, emphasis: true },
            { label: 'Net margin %', value: profit.netMargin ?? profit.grossMargin, isPct: true },
          ].map((k) => (
            <Card key={k.label} className={'emphasis' in k && k.emphasis ? 'border-primary/40 bg-primary/5' : ''}>
              <CardContent className="pt-5">
                <p className="text-sm text-muted-foreground">{k.label}</p>
                <p className="text-xl font-bold tabular-nums">
                  {k.isPct ? `${Number(k.value || 0).toFixed(1)}%` : formatCurrency(Number(k.value || 0))}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Record expense</CardTitle>
          <CardDescription>Rent, salaries, utilities — deducted from gross profit for net profit</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-5">
          <select
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
            value={expForm.category}
            onChange={(e) => setExpForm({ ...expForm, category: e.target.value })}
          >
            {['rent', 'salaries', 'utilities', 'transport', 'supplies', 'marketing', 'maintenance', 'taxes_fees', 'other'].map(
              (c) => (
                <option key={c} value={c}>
                  {c.replace('_', ' ')}
                </option>
              )
            )}
          </select>
          <Input
            placeholder="Description"
            value={expForm.description}
            onChange={(e) => setExpForm({ ...expForm, description: e.target.value })}
          />
          <Input
            type="number"
            placeholder="Amount"
            value={expForm.amount}
            onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })}
          />
          <Input
            type="date"
            value={expForm.expenseDate}
            onChange={(e) => setExpForm({ ...expForm, expenseDate: e.target.value })}
          />
          <Button loading={addExpense.isPending} onClick={() => addExpense.mutate()}>
            Add expense
          </Button>
        </CardContent>
      </Card>

      <DataTable
        columns={['Date', 'Category', 'Description', 'Amount', '']}
        rows={(expenses?.rows || []).map((r) => [
          formatDate(r.expenseDate),
          r.category,
          r.description || '—',
          formatCurrency(Number(r.amount)),
          <Button
            key="d"
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => {
              if (window.confirm('Delete this expense?')) delExpense.mutate(r.id);
            }}
          >
            Delete
          </Button>,
        ])}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Chart of accounts</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={['Code', 'Name', 'Type', 'Balance']}
            rows={(data?.data || []).map((a: { code: string; name: string; type: string; balance: number }) => [
              <span key="c" className="font-mono text-xs">
                {a.code}
              </span>,
              a.name,
              <Badge key="t" variant="outline">
                {a.type}
              </Badge>,
              formatCurrency(Number(a.balance)),
            ])}
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}

export function HrPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ firstName: '', lastName: '', position: '', phone: '' });
  const { data } = useQuery({
    queryKey: ['employees'],
    queryFn: async () => (await api.get('/employees')).data,
  });
  const create = useMutation({
    mutationFn: async () => api.post('/employees', form),
    onSuccess: () => {
      toast.success('Employee added');
      setForm({ firstName: '', lastName: '', position: '', phone: '' });
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <PageShell title="Human Resources" description="Employees, attendance & payroll-ready records">
      <Card>
        <CardContent className="pt-5 grid gap-3 sm:grid-cols-5">
          <Input placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          <Input placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          <Input placeholder="Position" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
          <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Button loading={create.isPending} disabled={!form.firstName || !form.lastName} onClick={() => create.mutate()}>
            Add employee
          </Button>
        </CardContent>
      </Card>
      <DataTable
        columns={['Employee #', 'Name', 'Position', 'Status']}
        rows={(data?.data || []).map((e: { employeeNo: string; firstName: string; lastName: string; position?: string; status: string }) => [
          e.employeeNo,
          `${e.firstName} ${e.lastName}`,
          e.position || 'â€”',
          <Badge key="s" variant={e.status === 'ACTIVE' ? 'success' : 'secondary'}>
            {e.status}
          </Badge>,
        ])}
      />
    </PageShell>
  );
}

// ════════════════════ REPORTS ════════════════════
type ReportKind = 'sales' | 'inventory' | 'profit' | 'product-profit' | 'balances' | 'aging';

function ReportTable({ kind, data }: { kind: ReportKind; data: unknown }) {
  if (data == null) return null;

  if (kind === 'aging') {
    const d = data as {
      buckets?: {
        current: number;
        days1to30: number;
        days31to60: number;
        days61to90: number;
        days90plus: number;
        total: number;
      };
      rows?: Array<{
        invoiceNo: string;
        customer: string;
        balance: number;
        daysPastDue: number;
        bucket: string;
      }>;
    };
    const b = d.buckets;
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {[
            ['Current', b?.current],
            ['1–30', b?.days1to30],
            ['31–60', b?.days31to60],
            ['61–90', b?.days61to90],
            ['90+', b?.days90plus],
            ['Total', b?.total],
          ].map(([label, val]) => (
            <div key={String(label)} className="rounded-xl border border-border p-3">
              <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
              <p className="text-sm font-bold tabular-nums">{formatCurrency(Number(val || 0))}</p>
            </div>
          ))}
        </div>
        <div className="table-scroll rounded-xl border border-border max-h-[22rem] overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/80 sticky top-0">
              <tr className="text-left text-muted-foreground border-b">
                <th className="p-2">Invoice</th>
                <th className="p-2">Customer</th>
                <th className="p-2 text-right">Days</th>
                <th className="p-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {(d.rows || []).map((r, i) => (
                <tr key={r.invoiceNo + i} className="border-b border-border/50 odd:bg-muted/20">
                  <td className="p-2 font-mono">{r.invoiceNo}</td>
                  <td className="p-2">{r.customer}</td>
                  <td className="p-2 text-right">{r.daysPastDue}</td>
                  <td className="p-2 text-right font-semibold">
                    {formatCurrency(Number(r.balance))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (kind === 'sales') {
    const d = data as {
      from?: string;
      to?: string;
      totals?: { count: number; total: number; paid: number; tax: number; discount: number };
      sales?: Array<{
        saleNo: string;
        saleDate: string;
        total: number | string;
        paidAmount: number | string;
        taxAmount: number | string;
        discountAmount: number | string;
        subtotal: number | string;
        paymentStatus?: string;
        status?: string;
        customer?: { firstName?: string; lastName?: string; businessName?: string } | null;
        cashier?: { firstName?: string; lastName?: string } | null;
      }>;
    };
    const rows = d.sales || [];
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>
            Period: {d.from ? new Date(d.from).toLocaleDateString() : '—'} –{' '}
            {d.to ? new Date(d.to).toLocaleDateString() : '—'}
          </span>
          <span>{d.totals?.count ?? rows.length} sales</span>
          <span className="font-semibold text-foreground">
            Total {formatCurrency(Number(d.totals?.total || 0))}
          </span>
        </div>
        <div className="table-scroll rounded-xl border border-border max-h-[28rem] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/95 backdrop-blur z-[1]">
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="p-2.5 font-semibold">Date</th>
                <th className="p-2.5 font-semibold">Sale #</th>
                <th className="p-2.5 font-semibold">Customer</th>
                <th className="p-2.5 font-semibold">Cashier</th>
                <th className="p-2.5 font-semibold text-right">Subtotal</th>
                <th className="p-2.5 font-semibold text-right">Tax</th>
                <th className="p-2.5 font-semibold text-right">Total</th>
                <th className="p-2.5 font-semibold text-right">Paid</th>
                <th className="p-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => {
                const cust =
                  s.customer?.businessName ||
                  `${s.customer?.firstName || ''} ${s.customer?.lastName || ''}`.trim() ||
                  'Walk-in';
                const cash = s.cashier
                  ? `${s.cashier.firstName || ''} ${s.cashier.lastName || ''}`.trim()
                  : '—';
                return (
                  <tr
                    key={s.saleNo + i}
                    className="border-b border-border/60 odd:bg-muted/20 hover:bg-primary/5"
                  >
                    <td className="p-2.5 whitespace-nowrap">
                      {s.saleDate ? new Date(s.saleDate).toLocaleString() : '—'}
                    </td>
                    <td className="p-2.5 font-mono font-medium">{s.saleNo}</td>
                    <td className="p-2.5 max-w-[8rem] truncate">{cust}</td>
                    <td className="p-2.5 truncate max-w-[6rem]">{cash}</td>
                    <td className="p-2.5 text-right tabular-nums">
                      {formatCurrency(Number(s.subtotal))}
                    </td>
                    <td className="p-2.5 text-right tabular-nums">
                      {formatCurrency(Number(s.taxAmount))}
                    </td>
                    <td className="p-2.5 text-right tabular-nums font-semibold">
                      {formatCurrency(Number(s.total))}
                    </td>
                    <td className="p-2.5 text-right tabular-nums">
                      {formatCurrency(Number(s.paidAmount))}
                    </td>
                    <td className="p-2.5">
                      <Badge variant="secondary" className="text-[10px]">
                        {s.paymentStatus || s.status || '—'}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-muted-foreground">
                    No sales in this period
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (kind === 'inventory') {
    const d = data as {
      totalSkus?: number;
      totalUnits?: number;
      totalValue?: number;
      lowStockCount?: number;
      rows?: Array<{
        sku: string;
        name: string;
        category?: string;
        quantity: number;
        costPrice: number;
        sellingPrice: number;
        value: number;
        reorderLevel: number;
        lowStock: boolean;
      }>;
    };
    const rows = d.rows || [];
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>{d.totalSkus ?? rows.length} SKUs</span>
          <span>{d.totalUnits ?? 0} units</span>
          <span className="font-semibold text-foreground">
            Value {formatCurrency(Number(d.totalValue || 0))}
          </span>
          <span className="text-destructive">{d.lowStockCount ?? 0} low stock</span>
        </div>
        <div className="table-scroll rounded-xl border border-border max-h-[28rem] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/95 backdrop-blur z-[1]">
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="p-2.5 font-semibold">SKU</th>
                <th className="p-2.5 font-semibold">Product</th>
                <th className="p-2.5 font-semibold">Category</th>
                <th className="p-2.5 font-semibold text-right">Qty</th>
                <th className="p-2.5 font-semibold text-right">Cost</th>
                <th className="p-2.5 font-semibold text-right">Sell</th>
                <th className="p-2.5 font-semibold text-right">Value</th>
                <th className="p-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.sku + i}
                  className="border-b border-border/60 odd:bg-muted/20 hover:bg-primary/5"
                >
                  <td className="p-2.5 font-mono">{r.sku}</td>
                  <td className="p-2.5 font-medium max-w-[12rem] truncate">{r.name}</td>
                  <td className="p-2.5 text-muted-foreground">{r.category || '—'}</td>
                  <td className="p-2.5 text-right tabular-nums">{r.quantity}</td>
                  <td className="p-2.5 text-right tabular-nums">
                    {formatCurrency(Number(r.costPrice))}
                  </td>
                  <td className="p-2.5 text-right tabular-nums">
                    {formatCurrency(Number(r.sellingPrice))}
                  </td>
                  <td className="p-2.5 text-right tabular-nums font-semibold">
                    {formatCurrency(Number(r.value))}
                  </td>
                  <td className="p-2.5">
                    <Badge variant={r.lowStock ? 'destructive' : 'success'} className="text-[10px]">
                      {r.lowStock ? 'LOW' : 'OK'}
                    </Badge>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    No inventory rows
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (kind === 'product-profit') {
    const d = data as {
      from?: string;
      to?: string;
      rows?: Array<{
        name: string;
        sku: string;
        quantity: number;
        revenue: number;
        cogs: number;
        profit: number;
        margin: number;
      }>;
      totals?: { revenue: number; cogs: number; profit: number };
    };
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {d.from ? new Date(d.from).toLocaleDateString() : '—'} –{' '}
          {d.to ? new Date(d.to).toLocaleDateString() : '—'}
          {d.totals
            ? ` · Total profit ${formatCurrency(d.totals.profit)}`
            : ''}
        </p>
        <div className="table-scroll rounded-xl border border-border max-h-[28rem] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/95">
              <tr className="text-left text-muted-foreground border-b">
                <th className="p-2.5">Product</th>
                <th className="p-2.5">SKU</th>
                <th className="p-2.5 text-right">Qty</th>
                <th className="p-2.5 text-right">Revenue</th>
                <th className="p-2.5 text-right">COGS</th>
                <th className="p-2.5 text-right">Profit</th>
                <th className="p-2.5 text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {(d.rows || []).map((r) => (
                <tr key={r.sku + r.name} className="border-b border-border/50 odd:bg-muted/20">
                  <td className="p-2.5 font-medium">{r.name}</td>
                  <td className="p-2.5 font-mono text-muted-foreground">{r.sku}</td>
                  <td className="p-2.5 text-right tabular-nums">{r.quantity}</td>
                  <td className="p-2.5 text-right tabular-nums">{formatCurrency(r.revenue)}</td>
                  <td className="p-2.5 text-right tabular-nums">{formatCurrency(r.cogs)}</td>
                  <td className="p-2.5 text-right tabular-nums font-semibold">{formatCurrency(r.profit)}</td>
                  <td className="p-2.5 text-right tabular-nums">{r.margin.toFixed(1)}%</td>
                </tr>
              ))}
              {!d.rows?.length && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    No product sales in this period
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (kind === 'profit') {
    const d = data as {
      from?: string;
      to?: string;
      revenue?: number;
      netRevenue?: number;
      tax?: number;
      cogs?: number;
      grossProfit?: number;
      grossMargin?: number;
      expenses?: number;
      netProfit?: number;
      netMargin?: number;
      purchases?: number;
    };
    const lines = [
      { label: 'Gross sales (incl. tax)', value: d.revenue },
      { label: 'Tax collected', value: d.tax },
      { label: 'Net sales (ex-tax)', value: d.netRevenue ?? d.revenue },
      { label: 'Cost of goods sold', value: d.cogs },
      { label: 'Gross profit', value: d.grossProfit },
      { label: 'Operating expenses', value: d.expenses },
      { label: 'Net profit', value: d.netProfit ?? d.grossProfit, emphasis: true },
      { label: 'Purchases (period, reference)', value: d.purchases },
    ];
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {d.from ? new Date(d.from).toLocaleDateString() : '—'} –{' '}
          {d.to ? new Date(d.to).toLocaleDateString() : '—'}
          {d.netMargin != null
            ? ` · Net margin ${Number(d.netMargin).toFixed(1)}%`
            : d.grossMargin != null
              ? ` · Gross margin ${Number(d.grossMargin).toFixed(1)}%`
              : ''}
          {' · Net profit = gross profit − expenses'}
        </p>
        <div className="table-scroll rounded-xl border border-border overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/80">
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="p-3 font-semibold">Line item</th>
                <th className="p-3 font-semibold text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr
                  key={l.label}
                  className={`border-b border-border/60 ${l.emphasis ? 'bg-primary/5 font-semibold' : 'odd:bg-muted/20'}`}
                >
                  <td className="p-3">{l.label}</td>
                  <td className="p-3 text-right tabular-nums">
                    {formatCurrency(Number(l.value || 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // balances
  const rows = (Array.isArray(data) ? data : []) as Array<{
    code?: string;
    firstName?: string;
    lastName?: string;
    businessName?: string;
    phone?: string;
    balance?: number | string;
    creditLimit?: number | string | null;
  }>;
  const total = rows.reduce((s, r) => s + Number(r.balance || 0), 0);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {rows.length} customers · Outstanding{' '}
        <span className="font-semibold text-foreground">{formatCurrency(total)}</span>
      </p>
      <div className="table-scroll rounded-xl border border-border max-h-[28rem] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/95 backdrop-blur z-[1]">
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="p-2.5 font-semibold">Code</th>
              <th className="p-2.5 font-semibold">Customer</th>
              <th className="p-2.5 font-semibold">Phone</th>
              <th className="p-2.5 font-semibold text-right">Balance</th>
              <th className="p-2.5 font-semibold text-right">Credit limit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const name =
                r.businessName || `${r.firstName || ''} ${r.lastName || ''}`.trim() || '—';
              return (
                <tr key={(r.code || '') + i} className="border-b border-border/60 odd:bg-muted/20">
                  <td className="p-2.5 font-mono">{r.code || '—'}</td>
                  <td className="p-2.5 font-medium">{name}</td>
                  <td className="p-2.5">
                    <PhoneActions phone={r.phone} messageBody={`Hi ${name}, `} />
                  </td>
                  <td className="p-2.5 text-right tabular-nums font-semibold">
                    {formatCurrency(Number(r.balance || 0))}
                  </td>
                  <td className="p-2.5 text-right tabular-nums">
                    {r.creditLimit != null ? formatCurrency(Number(r.creditLimit)) : '—'}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-muted-foreground">
                  No outstanding balances
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ReportsPage() {
  const reports: Array<{
    name: string;
    desc: string;
    kind: ReportKind;
    view: string;
    pdf: string;
    excel?: string;
    csv?: string;
  }> = [
    {
      name: 'Sales Report',
      desc: 'All sales with totals',
      kind: 'sales',
      excel: '/reports/sales.xlsx',
      csv: '/reports/sales.csv',
      view: '/reports/sales',
      pdf: '/reports/sales.pdf',
    },
    {
      name: 'Inventory Valuation',
      desc: 'Stock qty & value',
      kind: 'inventory',
      excel: '/reports/inventory.xlsx',
      view: '/reports/inventory',
      pdf: '/reports/inventory.pdf',
    },
    {
      name: 'Profit & Loss',
      desc: 'Revenue, COGS, expenses, net profit',
      kind: 'profit',
      view: '/reports/profit',
      pdf: '/reports/profit.pdf',
    },
    {
      name: 'Product Profit',
      desc: 'Margin by SKU',
      kind: 'product-profit',
      view: '/reports/product-profit',
      pdf: '/reports/profit.pdf',
    },
    {
      name: 'Customer Balances',
      desc: 'Outstanding AR',
      kind: 'balances',
      view: '/reports/customer-balances',
      pdf: '/reports/customer-balances.pdf',
    },
    {
      name: 'AR Aging',
      desc: '0–30 / 31–60 / 90+ buckets',
      kind: 'aging',
      view: '/reports/ar-aging',
      pdf: '/reports/ar-aging.pdf',
    },
  ];

  const [preview, setPreview] = useState<unknown>(null);
  const [previewTitle, setPreviewTitle] = useState('');
  const [previewKind, setPreviewKind] = useState<ReportKind | null>(null);
  const [previewPdf, setPreviewPdf] = useState<string | null>(null);
  const [loadingView, setLoadingView] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const withDates = (path: string) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const qs = q.toString();
    return qs ? `${path}?${qs}` : path;
  };

  const loadPreview = async (path: string, title: string, kind: ReportKind, pdf: string) => {
    setLoadingView(true);
    try {
      const res = await api.get(withDates(path));
      setPreview(res.data.data);
      setPreviewTitle(title);
      setPreviewKind(kind);
      setPreviewPdf(withDates(pdf));
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setLoadingView(false);
    }
  };

  return (
    <PageShell title="Reports" description="Live reports — table view, PDF, Excel, CSV & backup">
      <Card>
        <CardContent className="p-3 flex flex-wrap gap-2 items-end">
          <div>
            <label className="text-[10px] text-muted-foreground">From</label>
            <Input type="date" className="h-9" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">To</label>
            <Input type="date" className="h-9" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <p className="text-[11px] text-muted-foreground pb-2">
            Applied to sales, profit & PDF downloads
          </p>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:ml-auto pb-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                downloadAuth('/reports/customers.csv', 'customers.csv')
                  .then(() => toast.success('Customers CSV downloaded'))
                  .catch((e) => toast.error(getErrorMessage(e)))
              }
            >
              <Download className="h-3.5 w-3.5" /> Customers
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                downloadAuth('/reports/products.csv', 'products.csv')
                  .then(() => toast.success('Products CSV downloaded'))
                  .catch((e) => toast.error(getErrorMessage(e)))
              }
            >
              <Download className="h-3.5 w-3.5" /> Products
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                downloadAuth(withDates('/reports/expenses.csv'), 'expenses.csv')
                  .then(() => toast.success('Expenses CSV downloaded'))
                  .catch((e) => toast.error(getErrorMessage(e)))
              }
            >
              <Download className="h-3.5 w-3.5" /> Expenses
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={() =>
                downloadAuth('/reports/backup.txt', 'ims-backup.txt')
                  .then(() => toast.success('Full backup downloaded'))
                  .catch((e) => toast.error(getErrorMessage(e)))
              }
            >
              <Download className="h-3.5 w-3.5" /> Full backup
            </Button>
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {reports.map((r) => (
          <Card key={r.name} className="hover:border-primary/50 transition-colors">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{r.name}</CardTitle>
              <CardDescription>{r.desc}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                loading={loadingView}
                onClick={() => loadPreview(r.view, r.name, r.kind, r.pdf)}
              >
                View
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() =>
                  downloadAuth(
                    withDates(r.pdf),
                    `${r.name.replace(/\s+/g, '-').toLowerCase()}.pdf`
                  )
                    .then(() => toast.success('PDF downloaded'))
                    .catch((e) => toast.error(getErrorMessage(e)))
                }
              >
                <FileText className="h-3.5 w-3.5" /> PDF
              </Button>
              {r.excel && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    downloadAuth(r.excel!, `${r.name.replace(/\s+/g, '-').toLowerCase()}.xlsx`)
                      .then(() => toast.success('Excel downloaded'))
                      .catch((e) => toast.error(getErrorMessage(e)))
                  }
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
                </Button>
              )}
              {r.csv && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    downloadAuth(r.csv!, 'sales.csv')
                      .then(() => toast.success('CSV downloaded'))
                      .catch((e) => toast.error(getErrorMessage(e)))
                  }
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {preview != null && previewKind && (
        <Card className="print:shadow-none">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">{previewTitle}</CardTitle>
            <div className="flex flex-wrap gap-2">
              {previewPdf && (
                <Button
                  size="sm"
                  onClick={() =>
                    downloadAuth(
                      previewPdf,
                      `${previewTitle.replace(/\s+/g, '-').toLowerCase()}.pdf`
                    )
                      .then(() => toast.success('PDF downloaded'))
                      .catch((e) => toast.error(getErrorMessage(e)))
                  }
                >
                  <FileText className="h-4 w-4" /> Download PDF
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => window.print()}>
                <Printer className="h-4 w-4" /> Print page
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ReportTable kind={previewKind} data={preview} />
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}


// Settings hub lives in pages/settings (separate screens for Profile, Currency, Staff, Fonts)
export { SettingsHubPage as SettingsPage } from '@/pages/settings/SettingsHubPage';
