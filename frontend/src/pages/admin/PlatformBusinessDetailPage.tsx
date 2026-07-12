import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Receipt,
  Search,
  Shield,
  X,
} from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { type CredentialUser, statusVariant } from './platformTypes';

type PlatformSaleRow = {
  id: string;
  saleNo: string;
  total: number | string;
  subtotal?: number | string;
  taxAmount?: number | string;
  discountAmount?: number | string;
  paidAmount?: number | string;
  paymentStatus: string;
  paymentMethod?: string;
  status: string;
  currency?: string;
  saleDate: string;
  notes?: string | null;
  customer?: {
    firstName?: string;
    lastName?: string;
    businessName?: string;
  } | null;
  cashier?: {
    firstName?: string;
    lastName?: string;
    email?: string;
  } | null;
  branch?: { name?: string } | null;
  _count?: { items: number };
};

type PlatformSaleDetail = PlatformSaleRow & {
  items?: Array<{
    id: string;
    productName: string;
    sku?: string | null;
    quantity: number | string;
    unitPrice: number | string;
    discount?: number | string;
    taxAmount?: number | string;
    total: number | string;
  }>;
  payments?: Array<{
    id: string;
    amount: number | string;
    method: string;
    currency?: string;
    paidAt?: string;
    reference?: string | null;
  }>;
};

function customerLabel(c?: PlatformSaleRow['customer']) {
  if (!c) return 'Walk-in';
  return (
    c.businessName ||
    `${c.firstName || ''} ${c.lastName || ''}`.trim() ||
    'Walk-in'
  );
}

function paymentBadgeVariant(
  status: string
): 'success' | 'warning' | 'destructive' | 'secondary' {
  if (status === 'PAID') return 'success';
  if (status === 'REFUNDED' || status === 'VOID') return 'destructive';
  if (status === 'PARTIAL' || status === 'UNPAID') return 'warning';
  return 'secondary';
}

/** Format amounts in the tenant's own currency (no FX conversion for platform view). */
function money(value: number | string, currency = 'USD') {
  return formatCurrency(value, { currency, raw: true });
}

/**
 * Super Admin — single business detail / edit screen.
 */
export function PlatformBusinessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = !!user?.roles?.includes('SUPER_ADMIN');
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [showPasswords, setShowPasswords] = useState(true);
  const [customPw, setCustomPw] = useState<Record<string, string>>({});
  const [revealedPw, setRevealedPw] = useState<Record<string, string>>({});
  const credentialsRef = useRef<HTMLDivElement | null>(null);
  const salesRef = useRef<HTMLDivElement | null>(null);

  const [salesSearch, setSalesSearch] = useState('');
  const [debouncedSalesSearch, setDebouncedSalesSearch] = useState('');
  const [salesStatus, setSalesStatus] = useState('');
  const [salesPaymentStatus, setSalesPaymentStatus] = useState('');
  const [salesFrom, setSalesFrom] = useState('');
  const [salesTo, setSalesTo] = useState('');
  const [salesPage, setSalesPage] = useState(1);
  const [detailSaleId, setDetailSaleId] = useState<string | null>(null);
  const salesPageSize = 25;

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSalesSearch(salesSearch.trim());
      setSalesPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [salesSearch]);

  useEffect(() => {
    setSalesPage(1);
  }, [salesStatus, salesPaymentStatus, salesFrom, salesTo]);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['platform-company', id],
    enabled: isSuperAdmin && !!id,
    queryFn: async () => (await api.get(`/platform/companies/${id}`)).data.data,
  });

  const companyCurrency = detail?.company?.currency || 'USD';

  const {
    data: salesRes,
    isLoading: salesLoading,
    isFetching: salesFetching,
    refetch: refetchSales,
  } = useQuery({
    queryKey: [
      'platform-company-sales',
      id,
      debouncedSalesSearch,
      salesStatus,
      salesPaymentStatus,
      salesFrom,
      salesTo,
      salesPage,
    ],
    enabled: isSuperAdmin && !!id,
    queryFn: async () => {
      const res = await api.get(`/platform/companies/${id}/sales`, {
        params: {
          page: salesPage,
          limit: salesPageSize,
          search: debouncedSalesSearch || undefined,
          status: salesStatus || undefined,
          paymentStatus: salesPaymentStatus || undefined,
          from: salesFrom || undefined,
          to: salesTo || undefined,
          sortBy: 'saleDate',
          sortOrder: 'desc',
        },
      });
      return res.data as {
        data: PlatformSaleRow[];
        meta: {
          total: number;
          page: number;
          limit: number;
          totalPages: number;
          summary?: {
            filteredCount: number;
            activeCount: number;
            revenue: number;
            tax: number;
            discount: number;
            paid: number;
            averageTicket: number;
            currency: string;
          };
        };
      };
    },
  });

  const { data: saleDetailRes, isLoading: saleDetailLoading } = useQuery({
    queryKey: ['platform-company-sale', id, detailSaleId],
    enabled: isSuperAdmin && !!id && !!detailSaleId,
    queryFn: async () =>
      (await api.get(`/platform/companies/${id}/sales/${detailSaleId}`)).data.data as {
        sale: PlatformSaleDetail;
        company: { currency?: string };
      },
  });

  useEffect(() => {
    if (!detail) return;
    const tab = searchParams.get('tab');
    if (tab === 'passwords') {
      window.setTimeout(() => {
        credentialsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 200);
    } else if (tab === 'sales') {
      window.setTimeout(() => {
        salesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 200);
    }
  }, [searchParams, detail]);

  const statusMutation = useMutation({
    mutationFn: async (newStatus: string) =>
      api.patch(`/platform/companies/${id}/status`, { status: newStatus, note: note || undefined }),
    onSuccess: () => {
      toast.success('Business status updated');
      setNote('');
      void qc.invalidateQueries({ queryKey: ['platform-companies'] });
      void qc.invalidateQueries({ queryKey: ['platform-overview'] });
      void qc.invalidateQueries({ queryKey: ['platform-company', id] });
      void qc.invalidateQueries({ queryKey: ['platform-activity'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({
      userId,
      password,
    }: {
      userId: string;
      password?: string;
    }) =>
      (
        await api.post(`/platform/companies/${id}/users/${userId}/password`, {
          password: password || undefined,
        })
      ).data.data as {
        loginEmail: string;
        password: string;
        firstName: string;
        lastName: string;
        message: string;
      },
    onSuccess: (data, vars) => {
      setRevealedPw((prev) => ({ ...prev, [vars.userId]: data.password }));
      setShowPasswords(true);
      toast.success(`Password set for ${data.loginEmail}`);
      void qc.invalidateQueries({ queryKey: ['platform-company', id] });
      void navigator.clipboard?.writeText(data.password).then(
        () => toast.message('Password copied to clipboard'),
        () => undefined
      );
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const copyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Could not copy — select and copy manually');
    }
  };

  if (!isSuperAdmin) {
    return <Navigate to="/app" replace />;
  }

  if (!id) {
    return <Navigate to="/app/platform/businesses" replace />;
  }

  return (
    <div className="page-container fit-x pb-6 space-y-4">
      <div className="flex items-start gap-2">
        <Link
          to="/app/platform/businesses"
          aria-label="Back to directory"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-muted mt-0.5"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold truncate">
            {detail?.company?.name || 'Business'}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground truncate">
            {detail?.company?.slug
              ? `${detail.company.slug} · edit status, passwords & monitor`
              : 'Loading…'}
          </p>
        </div>
        {detail?.company && (
          <Badge variant={statusVariant(detail.company.status)} className="shrink-0">
            {detail.company.status}
          </Badge>
        )}
      </div>

      {isLoading && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Loading business…
          </CardContent>
        </Card>
      )}

      {detail && (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {[
              {
                label: 'Revenue 30d',
                value: formatCurrency(detail.metrics.revenue30d, {
                  currency: companyCurrency,
                  raw: true,
                }),
              },
              {
                label: 'Sales 30d',
                value: formatNumber(detail.metrics.salesCount30d),
              },
              {
                label: 'All-time revenue',
                value: formatCurrency(detail.metrics.revenueAllTime || 0, {
                  currency: companyCurrency,
                  raw: true,
                }),
              },
              {
                label: 'All-time sales',
                value: formatNumber(detail.metrics.salesCountAllTime || 0),
              },
              {
                label: 'Inventory value',
                value: formatCurrency(detail.metrics.inventoryValue, {
                  currency: companyCurrency,
                  raw: true,
                }),
              },
              {
                label: 'Users / Products',
                value: `${detail.metrics.users} / ${detail.metrics.products}`,
              },
            ].map((m) => (
              <Card key={m.label}>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">{m.label}</p>
                  <p className="text-lg font-bold tabular-nums mt-1 truncate">{m.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setSearchParams({ tab: 'sales' });
                salesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              <Receipt className="h-3.5 w-3.5" /> View all sales
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSearchParams({ tab: 'passwords' });
                credentialsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              <KeyRound className="h-3.5 w-3.5" /> Passwords
            </Button>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Business info</CardTitle>
              <CardDescription>
                Joined {formatDate(detail.company.createdAt)}
                {detail.company.currency ? ` · ${detail.company.currency}` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 text-sm">
              <p>
                <span className="text-muted-foreground">Email: </span>
                {detail.company.email || '—'}
              </p>
              <p>
                <span className="text-muted-foreground">Phone: </span>
                {detail.company.phone || '—'}
              </p>
              <p className="sm:col-span-2">
                <span className="text-muted-foreground">Location: </span>
                {[detail.company.city, detail.company.country, detail.company.address]
                  .filter(Boolean)
                  .join(', ') || '—'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Sales trend (14 days)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={detail.salesTrend || []}>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} width={36} />
                    <Tooltip formatter={(v: number) => money(v, companyCurrency)} />
                    <Area
                      type="monotone"
                      dataKey="sales"
                      stroke="hsl(142 71% 45%)"
                      fill="hsl(142 71% 45% / 0.2)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Full sales history for this business */}
          <div
            ref={salesRef}
            className={
              searchParams.get('tab') === 'sales'
                ? 'rounded-xl border border-primary ring-2 ring-primary/25 space-y-3 p-1'
                : 'space-y-3'
            }
          >
            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Receipt className="h-4 w-4 text-primary" />
                      Business sales
                    </CardTitle>
                    <CardDescription>
                      Every sale recorded by this business · read-only super admin view
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={salesFetching}
                    onClick={() => void refetchSales()}
                  >
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {salesRes?.meta?.summary && (
                  <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
                    <div className="rounded-lg border border-border bg-muted/30 p-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Filtered revenue
                      </p>
                      <p className="text-sm font-bold tabular-nums">
                        {money(
                          salesRes.meta.summary.revenue,
                          salesRes.meta.summary.currency || companyCurrency
                        )}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/30 p-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Active sales
                      </p>
                      <p className="text-sm font-bold tabular-nums">
                        {formatNumber(salesRes.meta.summary.activeCount)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/30 p-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Avg ticket
                      </p>
                      <p className="text-sm font-bold tabular-nums">
                        {money(
                          salesRes.meta.summary.averageTicket,
                          salesRes.meta.summary.currency || companyCurrency
                        )}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/30 p-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Matching rows
                      </p>
                      <p className="text-sm font-bold tabular-nums">
                        {formatNumber(salesRes.meta.total)}
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 items-end">
                  <div className="relative min-w-[10rem] flex-1">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input
                      className="pl-8 h-9 text-sm"
                      placeholder="Sale #, customer, cashier…"
                      value={salesSearch}
                      onChange={(e) => setSalesSearch(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-0.5">From</label>
                    <Input
                      className="h-9 w-[9.5rem]"
                      type="date"
                      value={salesFrom}
                      onChange={(e) => setSalesFrom(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-0.5">To</label>
                    <Input
                      className="h-9 w-[9.5rem]"
                      type="date"
                      value={salesTo}
                      onChange={(e) => setSalesTo(e.target.value)}
                    />
                  </div>
                  <select
                    className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                    value={salesStatus}
                    onChange={(e) => setSalesStatus(e.target.value)}
                  >
                    <option value="">All statuses</option>
                    <option value="CONFIRMED">Confirmed</option>
                    <option value="RETURNED">Returned</option>
                    <option value="CANCELLED">Cancelled</option>
                  </select>
                  <select
                    className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                    value={salesPaymentStatus}
                    onChange={(e) => setSalesPaymentStatus(e.target.value)}
                  >
                    <option value="">All payments</option>
                    <option value="PAID">Paid</option>
                    <option value="PARTIAL">Partial</option>
                    <option value="UNPAID">Unpaid</option>
                    <option value="REFUNDED">Refunded</option>
                    <option value="VOID">Void</option>
                  </select>
                  {(salesSearch ||
                    salesStatus ||
                    salesPaymentStatus ||
                    salesFrom ||
                    salesTo) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setSalesSearch('');
                        setSalesStatus('');
                        setSalesPaymentStatus('');
                        setSalesFrom('');
                        setSalesTo('');
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>

                {/* Mobile sales cards */}
                <div className="grid gap-2 md:hidden">
                  {salesLoading && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Loading sales…
                    </p>
                  )}
                  {!salesLoading && (salesRes?.data || []).length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No sales match these filters
                    </p>
                  )}
                  {(salesRes?.data || []).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setDetailSaleId(s.id)}
                      className="text-left rounded-xl border border-border p-3 hover:border-primary/40 hover:bg-primary/5 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-sm font-semibold text-primary">
                            {s.saleNo}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {customerLabel(s.customer)}
                          </p>
                        </div>
                        <p className="font-bold tabular-nums shrink-0">
                          {money(Number(s.total), s.currency || companyCurrency)}
                        </p>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge variant={paymentBadgeVariant(s.paymentStatus)}>
                          {s.paymentStatus}
                        </Badge>
                        <Badge variant="secondary">{s.status}</Badge>
                        <span className="text-[11px] text-muted-foreground">
                          {formatDate(s.saleDate)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Desktop table */}
                <div className="hidden md:block table-scroll rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                        <th className="px-3 py-2.5 font-medium">Sale #</th>
                        <th className="px-3 py-2.5 font-medium">Customer</th>
                        <th className="px-3 py-2.5 font-medium">Cashier</th>
                        <th className="px-3 py-2.5 font-medium text-right">Items</th>
                        <th className="px-3 py-2.5 font-medium text-right">Total</th>
                        <th className="px-3 py-2.5 font-medium">Payment</th>
                        <th className="px-3 py-2.5 font-medium">Status</th>
                        <th className="px-3 py-2.5 font-medium">Date</th>
                        <th className="px-3 py-2.5 font-medium"> </th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesLoading && (
                        <tr>
                          <td
                            colSpan={9}
                            className="px-3 py-10 text-center text-muted-foreground"
                          >
                            Loading sales…
                          </td>
                        </tr>
                      )}
                      {!salesLoading && (salesRes?.data || []).length === 0 && (
                        <tr>
                          <td
                            colSpan={9}
                            className="px-3 py-10 text-center text-muted-foreground"
                          >
                            No sales found for this business
                          </td>
                        </tr>
                      )}
                      {(salesRes?.data || []).map((s) => (
                        <tr
                          key={s.id}
                          className="border-b border-border/60 hover:bg-muted/30 cursor-pointer"
                          onClick={() => setDetailSaleId(s.id)}
                        >
                          <td className="px-3 py-2.5 font-mono text-xs font-medium text-primary">
                            {s.saleNo}
                          </td>
                          <td className="px-3 py-2.5 max-w-[10rem] truncate">
                            {customerLabel(s.customer)}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground">
                            {s.cashier
                              ? `${s.cashier.firstName || ''} ${s.cashier.lastName || ''}`.trim() ||
                                s.cashier.email
                              : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {s._count?.items ?? '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                            {money(Number(s.total), s.currency || companyCurrency)}
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge variant={paymentBadgeVariant(s.paymentStatus)}>
                              {s.paymentStatus}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge variant="secondary">{s.status}</Badge>
                          </td>
                          <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                            {formatDate(s.saleDate)}
                          </td>
                          <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setDetailSaleId(s.id)}
                            >
                              Open
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {(() => {
                  const totalPages = Math.max(1, salesRes?.meta?.totalPages || 1);
                  const total = salesRes?.meta?.total ?? 0;
                  if (totalPages <= 1 && total <= salesPageSize) return null;
                  return (
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <p className="text-xs text-muted-foreground">
                        Page {salesPage} of {totalPages} · {formatNumber(total)} sales
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={salesPage <= 1 || salesLoading}
                          onClick={() => setSalesPage((p) => Math.max(1, p - 1))}
                        >
                          <ChevronLeft className="h-4 w-4" /> Prev
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={salesPage >= totalPages || salesLoading}
                          onClick={() => setSalesPage((p) => Math.min(totalPages, p + 1))}
                        >
                          Next <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </div>

          {/* Sale detail drawer / panel */}
          {detailSaleId && (
            <Card className="border-primary/30">
              <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                <div>
                  <CardTitle className="text-base">Sale detail</CardTitle>
                  <CardDescription>
                    {saleDetailRes?.sale?.saleNo || 'Loading…'} · read-only
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDetailSaleId(null)}
                  aria-label="Close sale detail"
                >
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {saleDetailLoading && (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Loading sale…
                  </p>
                )}
                {saleDetailRes?.sale && (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2 text-sm">
                      <p>
                        <span className="text-muted-foreground">Customer: </span>
                        {customerLabel(saleDetailRes.sale.customer)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Cashier: </span>
                        {saleDetailRes.sale.cashier
                          ? `${saleDetailRes.sale.cashier.firstName || ''} ${saleDetailRes.sale.cashier.lastName || ''}`.trim() ||
                            saleDetailRes.sale.cashier.email
                          : '—'}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Date: </span>
                        {formatDate(saleDetailRes.sale.saleDate)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Branch: </span>
                        {saleDetailRes.sale.branch?.name || '—'}
                      </p>
                      <p className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-muted-foreground">Payment: </span>
                        <Badge variant={paymentBadgeVariant(saleDetailRes.sale.paymentStatus)}>
                          {saleDetailRes.sale.paymentStatus}
                        </Badge>
                        {saleDetailRes.sale.paymentMethod && (
                          <span className="text-xs text-muted-foreground">
                            · {saleDetailRes.sale.paymentMethod}
                          </span>
                        )}
                      </p>
                      <p className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">Status: </span>
                        <Badge variant="secondary">{saleDetailRes.sale.status}</Badge>
                      </p>
                    </div>

                    <div className="table-scroll rounded-xl border border-border">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/40 text-left text-muted-foreground">
                            <th className="px-3 py-2">Item</th>
                            <th className="px-3 py-2 text-right">Qty</th>
                            <th className="px-3 py-2 text-right">Unit</th>
                            <th className="px-3 py-2 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(saleDetailRes.sale.items || []).map((item) => (
                            <tr key={item.id} className="border-t border-border/60">
                              <td className="px-3 py-2">
                                <p className="font-medium">{item.productName}</p>
                                {item.sku && (
                                  <p className="text-muted-foreground font-mono">{item.sku}</p>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {Number(item.quantity)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {money(
                                  Number(item.unitPrice),
                                  saleDetailRes.sale.currency || companyCurrency
                                )}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums font-medium">
                                {money(
                                  Number(item.total),
                                  saleDetailRes.sale.currency || companyCurrency
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="grid gap-1 text-sm max-w-xs ml-auto text-right">
                      <p>
                        <span className="text-muted-foreground">Subtotal: </span>
                        {money(
                          Number(saleDetailRes.sale.subtotal || 0),
                          saleDetailRes.sale.currency || companyCurrency
                        )}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Tax: </span>
                        {money(
                          Number(saleDetailRes.sale.taxAmount || 0),
                          saleDetailRes.sale.currency || companyCurrency
                        )}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Discount: </span>
                        {money(
                          Number(saleDetailRes.sale.discountAmount || 0),
                          saleDetailRes.sale.currency || companyCurrency
                        )}
                      </p>
                      <p className="text-base font-bold">
                        Total:{' '}
                        {money(
                          Number(saleDetailRes.sale.total),
                          saleDetailRes.sale.currency || companyCurrency
                        )}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Paid: </span>
                        {money(
                          Number(saleDetailRes.sale.paidAmount || 0),
                          saleDetailRes.sale.currency || companyCurrency
                        )}
                      </p>
                    </div>

                    {(saleDetailRes.sale.payments || []).length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">Payments</p>
                        {(saleDetailRes.sale.payments || []).map((p) => (
                          <div
                            key={p.id}
                            className="flex justify-between text-xs rounded-lg border border-border px-2.5 py-1.5"
                          >
                            <span>
                              {p.method}
                              {p.reference ? ` · ${p.reference}` : ''}
                              {p.paidAt ? ` · ${formatDate(p.paidAt)}` : ''}
                            </span>
                            <span className="tabular-nums font-medium">
                              {money(
                                Number(p.amount),
                                p.currency || saleDetailRes.sale.currency || companyCurrency
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {saleDetailRes.sale.notes && (
                      <p className="text-xs text-muted-foreground">
                        Notes: {saleDetailRes.sale.notes}
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Owners / admins</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-48 overflow-y-auto">
                {(detail.owners || []).map(
                  (o: {
                    id: string;
                    email: string;
                    firstName: string;
                    lastName: string;
                    status: string;
                    lastLoginAt?: string;
                  }) => (
                    <div key={o.id} className="rounded-lg border border-border p-2 text-sm">
                      <p className="font-medium">
                        {o.firstName} {o.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground">{o.email}</p>
                      <p className="text-xs text-muted-foreground">
                        Last login: {o.lastLoginAt ? formatDate(o.lastLoginAt) : 'never'}
                      </p>
                    </div>
                  )
                )}
                {!detail.owners?.length && (
                  <p className="text-xs text-muted-foreground">No owner accounts found</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Top products (30d)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(detail.topProducts || []).map(
                  (p: { name: string; revenue: number; quantity: number }, i: number) => (
                    <div key={i} className="flex justify-between text-sm gap-2">
                      <span className="truncate pr-2">{p.name}</span>
                      <span className="tabular-nums font-medium shrink-0">
                        {money(p.revenue, companyCurrency)}
                      </span>
                    </div>
                  )
                )}
                {!detail.topProducts?.length && (
                  <p className="text-xs text-muted-foreground">No sales yet</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Passwords */}
          <div
            ref={credentialsRef}
            className={
              searchParams.get('tab') === 'passwords'
                ? 'rounded-xl border border-primary ring-2 ring-primary/25'
                : undefined
            }
          >
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-primary" />
                  Login credentials
                </CardTitle>
                <CardDescription>
                  View or set passwords for users on this business. Admin-generated passwords can be
                  viewed; user-chosen ones need a reset.
                </CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowPasswords((v) => !v)}>
                {showPasswords ? (
                  <>
                    <EyeOff className="h-3.5 w-3.5" /> Hide
                  </>
                ) : (
                  <>
                    <Eye className="h-3.5 w-3.5" /> Show
                  </>
                )}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="table-scroll rounded-xl border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/40 text-left text-muted-foreground">
                      <th className="px-3 py-2">User</th>
                      <th className="px-3 py-2">Login</th>
                      <th className="px-3 py-2">Password</th>
                      <th className="px-3 py-2">Roles</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {((detail.credentials || detail.users || []) as CredentialUser[]).map((u) => {
                      const pw =
                        revealedPw[u.id] || (u.knownPassword as string | null | undefined) || null;
                      return (
                        <tr key={u.id} className="border-t border-border/60 align-top">
                          <td className="px-3 py-2">
                            <p className="font-medium">
                              {u.firstName} {u.lastName}
                            </p>
                            <p className="text-muted-foreground">
                              Last login: {u.lastLoginAt ? formatDate(u.lastLoginAt) : 'never'}
                            </p>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="font-mono text-[11px] break-all">
                                {u.loginEmail || u.email}
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-1.5"
                                onClick={() => void copyText('Email', u.loginEmail || u.email)}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                          <td className="px-3 py-2 min-w-[120px]">
                            {showPasswords && pw ? (
                              <div className="flex items-center gap-1">
                                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                                  {pw}
                                </code>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-1.5"
                                  onClick={() => void copyText('Password', pw)}
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : pw ? (
                              <span className="text-muted-foreground">••••••••</span>
                            ) : (
                              <span className="text-muted-foreground italic">Not stored</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {u.roles?.map((r) => r.name || r.code).join(', ') || '—'}
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant={u.status === 'ACTIVE' ? 'success' : 'secondary'}>
                              {u.status}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-col gap-1.5 min-w-[150px]">
                              <Input
                                type="text"
                                className="h-8 text-xs"
                                placeholder="Custom password"
                                value={customPw[u.id] || ''}
                                onChange={(e) =>
                                  setCustomPw((prev) => ({ ...prev, [u.id]: e.target.value }))
                                }
                              />
                              <div className="flex flex-wrap gap-1">
                                <Button
                                  size="sm"
                                  disabled={
                                    !customPw[u.id]?.trim() || customPw[u.id].trim().length < 8
                                  }
                                  loading={
                                    resetPasswordMutation.isPending &&
                                    resetPasswordMutation.variables?.userId === u.id &&
                                    !!customPw[u.id]?.trim()
                                  }
                                  onClick={() =>
                                    resetPasswordMutation.mutate({
                                      userId: u.id,
                                      password: customPw[u.id]?.trim(),
                                    })
                                  }
                                >
                                  Save
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  loading={
                                    resetPasswordMutation.isPending &&
                                    resetPasswordMutation.variables?.userId === u.id &&
                                    !customPw[u.id]?.trim()
                                  }
                                  onClick={() => resetPasswordMutation.mutate({ userId: u.id })}
                                >
                                  Generate
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!detail.credentials?.length && !detail.users?.length && (
                <p className="text-xs text-muted-foreground">No users on this business yet.</p>
              )}
            </CardContent>
          </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4" /> Platform controls
              </CardTitle>
              <CardDescription>Change business status (audit logged)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="Optional note for status change"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="success"
                  loading={statusMutation.isPending}
                  onClick={() => statusMutation.mutate('ACTIVE')}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Activate
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={statusMutation.isPending}
                  onClick={() => statusMutation.mutate('TRIAL')}
                >
                  Set Trial
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  loading={statusMutation.isPending}
                  onClick={() => statusMutation.mutate('SUSPENDED')}
                >
                  <Ban className="h-3.5 w-3.5" /> Suspend
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  loading={statusMutation.isPending}
                  onClick={() => statusMutation.mutate('CANCELLED')}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tenant audit trail</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-56 overflow-y-auto">
              {(detail.auditLogs || []).map(
                (log: {
                  id: string;
                  action: string;
                  module: string;
                  createdAt: string;
                  user?: { email?: string; firstName?: string; lastName?: string } | null;
                }) => (
                  <div key={log.id} className="text-xs border-b border-border/50 pb-2">
                    <p className="font-medium">
                      {log.action} <span className="text-muted-foreground">· {log.module}</span>
                    </p>
                    <p className="text-muted-foreground">
                      {log.user
                        ? `${log.user.firstName || ''} ${log.user.lastName || ''} (${log.user.email})`
                        : 'System'}{' '}
                      · {formatDate(log.createdAt)}
                    </p>
                  </div>
                )
              )}
              {!detail.auditLogs?.length && (
                <p className="text-xs text-muted-foreground py-4 text-center">No audit events</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
