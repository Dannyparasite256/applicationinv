import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  ChevronLeft,
  ChevronRight,
  Receipt,
  Search,
  Shield,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { statusVariant } from './platformTypes';

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
  return c.businessName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Walk-in';
}

function paymentBadgeVariant(
  status: string
): 'success' | 'warning' | 'destructive' | 'secondary' {
  if (status === 'PAID') return 'success';
  if (status === 'REFUNDED' || status === 'VOID') return 'destructive';
  if (status === 'PARTIAL' || status === 'UNPAID') return 'warning';
  return 'secondary';
}

function money(value: number | string, currency = 'USD') {
  return formatCurrency(value, { currency, raw: true });
}

/**
 * Super Admin — dedicated full-screen sales list for one business.
 * Route: /app/platform/businesses/:id/sales
 */
export function PlatformBusinessSalesPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = !!user?.roles?.includes('SUPER_ADMIN');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [detailSaleId, setDetailSaleId] = useState<string | null>(null);
  const pageSize = 25;

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [status, paymentStatus, from, to]);

  const { data: companyDetail, isLoading: companyLoading } = useQuery({
    queryKey: ['platform-company', id],
    enabled: isSuperAdmin && !!id,
    queryFn: async () => (await api.get(`/platform/companies/${id}`)).data.data,
  });

  const company = companyDetail?.company;
  const companyCurrency = company?.currency || 'USD';

  const {
    data: salesRes,
    isLoading: salesLoading,
    isFetching: salesFetching,
    refetch,
  } = useQuery({
    queryKey: [
      'platform-company-sales',
      id,
      debouncedSearch,
      status,
      paymentStatus,
      from,
      to,
      page,
    ],
    enabled: isSuperAdmin && !!id,
    queryFn: async () => {
      const res = await api.get(`/platform/companies/${id}/sales`, {
        params: {
          page,
          limit: pageSize,
          search: debouncedSearch || undefined,
          status: status || undefined,
          paymentStatus: paymentStatus || undefined,
          from: from || undefined,
          to: to || undefined,
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

  if (!isSuperAdmin) {
    return <Navigate to="/app" replace />;
  }

  if (!id) {
    return <Navigate to="/app/platform/businesses" replace />;
  }

  const sales = salesRes?.data || [];
  const total = salesRes?.meta?.total ?? 0;
  const totalPages = Math.max(1, salesRes?.meta?.totalPages || 1);
  const summary = salesRes?.meta?.summary;
  const metrics = companyDetail?.metrics;
  const cur = summary?.currency || companyCurrency;

  return (
    <div className="page-container fit-x pb-6 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label="Back to business"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-muted mt-0.5"
          onClick={() => navigate(`/app/platform/businesses/${id}`)}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <Receipt className="h-5 w-5 text-primary shrink-0" />
            <h1 className="text-xl sm:text-2xl font-bold truncate">
              {companyLoading ? 'Sales…' : `${company?.name || 'Business'} · Sales`}
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground truncate">
            {company?.slug
              ? `${company.slug} · every sale for this business (super admin)`
              : 'Loading business…'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {company && (
            <Badge variant={statusVariant(company.status)}>{company.status}</Badge>
          )}
          <Badge variant="outline" className="hidden sm:inline-flex">
            <Shield className="h-3 w-3 mr-1" /> Super Admin
          </Badge>
        </div>
      </div>

      {/* Breadcrumb / jump links */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Link to="/app/platform" className="hover:text-foreground hover:underline">
          Platform
        </Link>
        <span>/</span>
        <Link to="/app/platform/businesses" className="hover:text-foreground hover:underline">
          Businesses
        </Link>
        <span>/</span>
        <Link
          to={`/app/platform/businesses/${id}`}
          className="hover:text-foreground hover:underline truncate max-w-[10rem]"
        >
          {company?.name || 'Business'}
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">Sales</span>
      </div>

      {/* KPI strip */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Revenue (30d)</p>
            <p className="text-lg font-bold tabular-nums mt-1 truncate">
              {money(metrics?.revenue30d || 0, companyCurrency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Sales (30d)</p>
            <p className="text-lg font-bold tabular-nums mt-1">
              {formatNumber(metrics?.salesCount30d || 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">All-time revenue</p>
            <p className="text-lg font-bold tabular-nums mt-1 truncate">
              {money(metrics?.revenueAllTime || 0, companyCurrency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">All-time sales</p>
            <p className="text-lg font-bold tabular-nums mt-1">
              {formatNumber(metrics?.salesCountAllTime || 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters + list */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                Sales history
              </CardTitle>
              <CardDescription>
                Search, filter, and open any sale for this business · read-only
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(`/app/platform/businesses/${id}`)}
              >
                Business details
              </Button>
              <Button size="sm" variant="outline" loading={salesFetching} onClick={() => void refetch()}>
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {summary && (
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
              <div className="rounded-lg border border-border bg-muted/30 p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Filtered revenue
                </p>
                <p className="text-sm font-bold tabular-nums">{money(summary.revenue, cur)}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Active sales
                </p>
                <p className="text-sm font-bold tabular-nums">
                  {formatNumber(summary.activeCount)}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Avg ticket
                </p>
                <p className="text-sm font-bold tabular-nums">
                  {money(summary.averageTicket, cur)}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Matching rows
                </p>
                <p className="text-sm font-bold tabular-nums">{formatNumber(total)}</p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 items-end">
            <div className="relative min-w-[10rem] flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-8 h-9 text-sm"
                placeholder="Sale #, customer, cashier…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">From</label>
              <Input
                className="h-9 w-[9.5rem]"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">To</label>
              <Input
                className="h-9 w-[9.5rem]"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <select
              className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="RETURNED">Returned</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <select
              className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value)}
            >
              <option value="">All payments</option>
              <option value="PAID">Paid</option>
              <option value="PARTIAL">Partial</option>
              <option value="UNPAID">Unpaid</option>
              <option value="REFUNDED">Refunded</option>
              <option value="VOID">Void</option>
            </select>
            {(search || status || paymentStatus || from || to) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setStatus('');
                  setPaymentStatus('');
                  setFrom('');
                  setTo('');
                }}
              >
                Clear
              </Button>
            )}
          </div>

          {/* Mobile cards */}
          <div className="grid gap-2 md:hidden">
            {salesLoading && (
              <p className="py-10 text-center text-sm text-muted-foreground">Loading sales…</p>
            )}
            {!salesLoading && sales.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No sales match these filters
              </p>
            )}
            {sales.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setDetailSaleId(s.id)}
                className="text-left rounded-xl border border-border p-3.5 hover:border-primary/40 hover:bg-primary/5 transition-colors active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold text-primary">{s.saleNo}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {customerLabel(s.customer)}
                    </p>
                  </div>
                  <p className="font-bold tabular-nums shrink-0">
                    {money(Number(s.total), s.currency || companyCurrency)}
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge variant={paymentBadgeVariant(s.paymentStatus)}>{s.paymentStatus}</Badge>
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
                    <td colSpan={9} className="px-3 py-12 text-center text-muted-foreground">
                      Loading sales…
                    </td>
                  </tr>
                )}
                {!salesLoading && sales.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-12 text-center text-muted-foreground">
                      No sales found for this business
                    </td>
                  </tr>
                )}
                {sales.map((s) => (
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
                      <Button size="sm" variant="outline" onClick={() => setDetailSaleId(s.id)}>
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(totalPages > 1 || total > pageSize) && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-xs text-muted-foreground">
                Page {page} of {totalPages} · {formatNumber(total)} sales
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1 || salesLoading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages || salesLoading}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sale detail panel */}
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
              <p className="text-sm text-muted-foreground py-6 text-center">Loading sale…</p>
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
                  <p className="text-xs text-muted-foreground">Notes: {saleDetailRes.sale.notes}</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
