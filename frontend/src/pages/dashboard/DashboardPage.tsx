import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';
import {
  DollarSign,
  ShoppingBag,
  AlertTriangle,
  TrendingUp,
  Wallet,
  Shield,
  Building2,
  Sparkles,
  Activity,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuthStore } from '@/stores/authStore';
import { useNetworkStore } from '@/stores/networkStore';
import { OnboardingChecklist } from '@/components/shared/OnboardingChecklist';
import { SkeletonKpiGrid } from '@/components/shared/Skeleton';
import { EmptyState } from '@/components/shared/EmptyState';

interface DashboardData {
  kpis: {
    salesToday: number;
    salesTodayCount: number;
    salesWeek: number;
    salesWeekCount?: number;
    salesMonth: number;
    salesMonthCount: number;
    purchasesMonth: number;
    /** Gross profit for the selected date range */
    profit: number;
    periodSales?: number;
    periodSalesCount?: number;
    periodProfit?: number;
    periodMargin?: number;
    periodCogs?: number;
    periodExpenses?: number;
    periodNetProfit?: number;
    periodNetMargin?: number;
    expenses?: number;
    netProfit?: number;
    netMargin?: number;
    cogs?: number;
    netRevenue?: number;
    grossMargin?: number;
    inventoryValue: number;
    lowStock: number;
    pendingOrders: number;
    customers: number;
    products: number;
  };
  salesChart: Array<{ date: string; sales: number; count: number }>;
  topProducts: Array<{ name: string; quantity: number; revenue: number }>;
  topCustomers: Array<{ name: string; total: number; orders: number }>;
  branchPerformance: Array<{ name: string; sales: number; orders: number }>;
  recentSales: Array<{
    id: string;
    saleNo: string;
    total: string | number;
    paymentStatus: string;
    saleDate: string;
    customer?: { firstName?: string; lastName?: string; businessName?: string } | null;
  }>;
}

function greetingForNow(name?: string) {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const roles = user?.roles || [];
  const isSuperAdmin = roles.includes('SUPER_ADMIN');
  const pendingCount = useNetworkStore((s) => s.pendingCount);
  const [range, setRange] = useState<'today' | '7d' | '30d' | 'mtd' | 'custom'>('mtd');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [branchId, setBranchId] = useState('');

  const rangeParams = useMemo(() => {
    /** Local calendar date — avoid toISOString() which shifts the day in non-UTC timezones */
    const localYmd = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const end = new Date();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    if (range === 'today') {
      /* same day */
    } else if (range === '7d') start.setDate(end.getDate() - 6);
    else if (range === '30d') start.setDate(end.getDate() - 29);
    else if (range === 'mtd') start.setDate(1);
    else if (range === 'custom' && from && to) {
      return { from, to, branchId: branchId || undefined };
    } else {
      start.setDate(1);
    }
    return { from: localYmd(start), to: localYmd(end), branchId: branchId || undefined };
  }, [range, from, to, branchId]);

  const { data: platformKpis } = useQuery({
    queryKey: ['platform-overview-mini'],
    enabled: isSuperAdmin,
    queryFn: async () => (await api.get('/platform/overview')).data.data?.kpis as {
      totalCompanies?: number;
      activeCompanies?: number;
      trialCompanies?: number;
      newThisWeek?: number;
    },
    staleTime: 60_000,
  });

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data.data as Array<{ id: string; name: string }>,
    staleTime: 120_000,
  });

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['dashboard', rangeParams],
    queryFn: async () => {
      try {
        const res = await api.get<{ data: DashboardData }>('/dashboard', {
          params: rangeParams,
        });
        const payload = res.data.data;
        const { saveSnapshot } = await import('@/lib/offline/db');
        await saveSnapshot('dashboard', payload);
        return payload;
      } catch {
        const { loadSnapshot } = await import('@/lib/offline/db');
        const cached = await loadSnapshot<DashboardData>('dashboard');
        if (cached) return cached;
        throw new Error('Dashboard unavailable offline');
      }
    },
    // Always treat as stale so refund/delete invalidation reloads KPIs immediately
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 30000,
  });

  const kpis = data?.kpis;

  const { data: activity } = useQuery({
    queryKey: ['tenant-activity'],
    enabled: !isSuperAdmin,
    queryFn: async () =>
      (
        await api.get('/activity', { params: { limit: 8 } })
      ).data.data as Array<{
        id: string;
        action: string;
        module: string;
        createdAt: string;
        user?: { firstName?: string; lastName?: string; email?: string } | null;
      }>,
    staleTime: 30_000,
    retry: 1,
  });

  const rangeLabel =
    range === 'today'
      ? 'Today'
      : range === '7d'
        ? 'Last 7 days'
        : range === '30d'
          ? 'Last 30 days'
          : range === 'mtd'
            ? 'This month'
            : from && to
              ? `${from} → ${to}`
              : 'Selected period';

  // Period metrics follow the date-range filter
  const periodProfit = kpis?.periodProfit ?? kpis?.profit ?? 0;
  const periodNetProfit = kpis?.periodNetProfit ?? kpis?.netProfit ?? periodProfit;
  const periodExpenses = kpis?.periodExpenses ?? kpis?.expenses ?? 0;
  const periodSales = kpis?.periodSales ?? kpis?.salesMonth ?? 0;
  const periodSalesCount = kpis?.periodSalesCount ?? kpis?.salesMonthCount ?? 0;
  const periodMargin = kpis?.periodNetMargin ?? kpis?.netMargin ?? kpis?.periodMargin ?? kpis?.grossMargin;

  // Calm owner dashboard — 4 primary KPIs only
  const heroCards = [
    {
      label: 'Sales today',
      value: formatCurrency(kpis?.salesToday || 0),
      sub: `${kpis?.salesTodayCount || 0} orders`,
      icon: DollarSign,
      color: 'text-primary',
      ring: 'from-primary/15 to-primary/5',
      to: '/app/sales',
    },
    {
      label: `Sales · ${rangeLabel}`,
      value: formatCurrency(periodSales),
      sub: `${periodSalesCount} sales`,
      icon: TrendingUp,
      color: 'text-accent',
      ring: 'from-cyan-500/15 to-cyan-500/5',
      to: '/app/sales',
    },
    {
      label: 'Net profit',
      value: formatCurrency(periodNetProfit),
      sub:
        periodMargin != null
          ? `${Number(periodMargin).toFixed(1)}% after expenses`
          : `Expenses ${formatCurrency(periodExpenses)}`,
      icon: Wallet,
      color: 'text-success',
      ring: 'from-emerald-500/15 to-emerald-500/5',
      to: '/app/accounting',
    },
    {
      label: 'Low stock',
      value: formatNumber(kpis?.lowStock || 0),
      sub: 'Items need reorder',
      icon: AlertTriangle,
      color: 'text-warning',
      ring: 'from-amber-500/15 to-amber-500/5',
      to: '/app/inventory#low-stock',
    },
  ];

  // Needs attention list
  const attention: Array<{ label: string; detail: string; to: string; tone: string }> = [];
  if ((kpis?.lowStock || 0) > 0) {
    attention.push({
      label: `${kpis?.lowStock} products low on stock`,
      detail: 'Create a purchase draft from Inventory',
      to: '/app/inventory#low-stock',
      tone: 'text-warning',
    });
  }
  if ((kpis?.pendingOrders || 0) > 0) {
    attention.push({
      label: `${kpis?.pendingOrders} purchases pending`,
      detail: 'Receive or follow up with suppliers',
      to: '/app/purchases',
      tone: 'text-primary',
    });
  }
  if (pendingCount > 0) {
    attention.push({
      label: `${pendingCount} offline sales waiting`,
      detail: 'Sync when connection is stable',
      to: '/app/sync',
      tone: 'text-accent',
    });
  }

  const topName = data?.topProducts?.[0]?.name;
  const story =
    (kpis?.salesTodayCount || 0) > 0
      ? `Today you made ${kpis?.salesTodayCount} sale(s) for ${formatCurrency(kpis?.salesToday || 0)}${topName ? ` · Top item: ${topName}` : ''}.`
      : topName
        ? `Standout product this period: ${topName}. Open POS when ready.`
        : 'No sales yet today — open POS for your first order.';

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="min-w-0">
          <p className="section-label mb-0.5">{user?.company?.name || 'Overview'}</p>
          <h1 className="page-title truncate">{greetingForNow(user?.firstName)}</h1>
          <p className="page-subtitle">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
            })}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to="/app/pos"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand-gradient px-3.5 text-xs font-semibold text-primary-foreground shadow-glow"
          >
            <ShoppingBag className="h-3.5 w-3.5" /> Open POS
          </Link>
          <Badge variant="secondary" className="h-7 rounded-full px-2.5 text-[11px] font-medium">
            {isFetching ? 'Refreshing…' : navigator.onLine ? 'Live' : 'Offline'}
          </Badge>
        </div>
      </div>

      <OnboardingChecklist />

      {/* Segmented period filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="segmented">
          {(
            [
              ['today', 'Today'],
              ['7d', '7d'],
              ['30d', '30d'],
              ['mtd', 'Month'],
              ['custom', 'Custom'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`segmented-item ${range === id ? 'segmented-item-active' : 'segmented-item-idle'}`}
              onClick={() => setRange(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <div className="flex gap-1.5">
            <Input type="date" className="h-8 w-auto text-xs" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" className="h-8 w-auto text-xs" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
        {(branches?.length || 0) > 0 && (
          <select
            className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
            <option value="">All branches</option>
            {branches!.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <Card className="border-border/50 bg-gradient-to-br from-primary/[0.06] via-card to-accent/[0.04] shadow-soft">
        <CardContent className="pt-3.5 pb-3.5 flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary shrink-0">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">Today at a glance</p>
            <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{story}</p>
          </div>
        </CardContent>
      </Card>

      {isSuperAdmin && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="rounded-lg bg-primary/15 p-2 text-primary shrink-0">
                <Shield className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 shrink-0" /> Platform Super Admin
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {formatNumber(platformKpis?.totalCompanies || 0)} businesses
                  {platformKpis?.activeCompanies != null
                    ? ` · ${platformKpis.activeCompanies} active`
                    : ''}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <Link
                to="/app/platform/businesses"
                className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                Business directory
              </Link>
              <Link
                to="/app/platform"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-muted"
              >
                Overview
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <SkeletonKpiGrid count={4} />
      ) : (
        <div className="grid gap-2.5 sm:gap-3 grid-cols-2 min-w-0">
          {heroCards.map((card, i) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, type: 'spring', stiffness: 320, damping: 28 }}
              className="kpi-card"
            >
              <Link to={card.to} className="block min-w-0 relative z-[1]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-muted-foreground truncate">{card.label}</p>
                    <p className="mt-1 text-lg sm:text-2xl font-bold money-value font-display truncate text-foreground">
                      {card.value}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground truncate">{card.sub}</p>
                  </div>
                  <div
                    className={`rounded-xl bg-gradient-to-br ${card.ring} p-2.5 shrink-0 ${card.color}`}
                  >
                    <card.icon className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}

      {/* Needs attention */}
      {attention.length > 0 && (
        <div className="space-y-2">
          <p className="section-label">Needs attention</p>
          <div className="space-y-1.5">
            {attention.map((a) => (
              <Link key={a.to + a.label} to={a.to} className="attention-item">
                <AlertTriangle className={`h-4 w-4 shrink-0 ${a.tone}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{a.label}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{a.detail}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {!isSuperAdmin && (
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Recent activity
            </CardTitle>
            <CardDescription>Latest actions in your business</CardDescription>
          </CardHeader>
          <CardContent className="space-y-0">
            {(activity || []).slice(0, 5).map((log) => (
              <div
                key={log.id}
                className="flex gap-3 py-2.5 border-b border-border/40 last:border-0"
              >
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {log.action}{' '}
                    <span className="text-muted-foreground font-normal">· {log.module}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {log.user
                      ? `${log.user.firstName || ''} ${log.user.lastName || ''}`.trim() ||
                        log.user.email
                      : 'System'}{' '}
                    · {new Date(log.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
            {!activity?.length && (
              <EmptyState
                icon={Activity}
                title="No activity yet"
                description="Sales, stock changes, and staff actions will show up here."
              />
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-2.5 sm:gap-3 lg:grid-cols-3 min-w-0">
        <Card className="lg:col-span-2 fit-x">
          <CardHeader>
            <CardTitle>Sales (14 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data?.salesChart || []} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(221 83% 53%)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(221 83% 53%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickMargin={4} />
                  <YAxis tick={{ fontSize: 10 }} width={40} />
                  <Tooltip
                    formatter={(v: number) => formatCurrency(v)}
                    contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }}
                  />
                  <Area type="monotone" dataKey="sales" stroke="hsl(221 83% 53%)" fill="url(#salesFill)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="fit-x">
          <CardHeader>
            <CardTitle>Top Products</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 sm:space-y-3">
            {(data?.topProducts || []).length === 0 && (
              <p className="text-sm text-muted-foreground">No sales data yet</p>
            )}
            {(data?.topProducts || []).map((p, i) => (
              <div key={i} className="flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium truncate">{p.name}</p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground">{formatNumber(p.quantity)} sold</p>
                </div>
                <p className="text-xs sm:text-sm font-semibold tabular-nums shrink-0">{formatCurrency(p.revenue)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-2.5 sm:gap-3 lg:grid-cols-3 min-w-0">
        <Card className="fit-x">
          <CardHeader>
            <CardTitle>Top Customers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 sm:space-y-3">
            {(data?.topCustomers || []).map((c, i) => (
              <div key={i} className="flex justify-between gap-2 text-xs sm:text-sm min-w-0">
                <span className="truncate min-w-0">{c.name}</span>
                <span className="font-medium tabular-nums shrink-0">{formatCurrency(c.total)}</span>
              </div>
            ))}
            {!data?.topCustomers?.length && (
              <p className="text-sm text-muted-foreground">No customer sales yet</p>
            )}
          </CardContent>
        </Card>

        <Card className="fit-x">
          <CardHeader>
            <CardTitle>Branch Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="chart-box-sm">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.branchPerformance || []} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} width={36} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="sales" fill="hsl(199 89% 48%)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="fit-x">
          <CardHeader>
            <CardTitle>Recent Sales</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 sm:space-y-3">
            {(data?.recentSales || []).map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 text-xs sm:text-sm min-w-0">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{s.saleNo}</p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                    {s.customer?.businessName ||
                      `${s.customer?.firstName || ''} ${s.customer?.lastName || ''}`.trim() ||
                      'Walk-in'}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold tabular-nums">{formatCurrency(Number(s.total))}</p>
                  <Badge variant={s.paymentStatus === 'PAID' ? 'success' : 'warning'} className="text-[10px]">
                    {s.paymentStatus}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
