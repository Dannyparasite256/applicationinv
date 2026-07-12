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
  Package,
  AlertTriangle,
  TrendingUp,
  Users,
  Truck,
  Wallet,
  Shield,
  Building2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuthStore } from '@/stores/authStore';

interface DashboardData {
  kpis: {
    salesToday: number;
    salesTodayCount: number;
    salesWeek: number;
    salesMonth: number;
    salesMonthCount: number;
    purchasesMonth: number;
    profit: number;
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

export function DashboardPage() {
  const roles = useAuthStore((s) => s.user?.roles || []);
  const isSuperAdmin = roles.includes('SUPER_ADMIN');

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

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      try {
        const res = await api.get<{ data: DashboardData }>('/dashboard');
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

  const cards = [
    { label: 'Sales Today', value: formatCurrency(kpis?.salesToday || 0), sub: `${kpis?.salesTodayCount || 0} orders`, icon: DollarSign, color: 'text-primary' },
    { label: 'Weekly Sales', value: formatCurrency(kpis?.salesWeek || 0), sub: 'This week', icon: TrendingUp, color: 'text-accent' },
    { label: 'Monthly Revenue', value: formatCurrency(kpis?.salesMonth || 0), sub: `${kpis?.salesMonthCount || 0} sales`, icon: Wallet, color: 'text-success' },
    { label: 'Inventory Value', value: formatCurrency(kpis?.inventoryValue || 0), sub: `${kpis?.products || 0} products`, icon: Package, color: 'text-warning' },
    { label: 'Low Stock', value: formatNumber(kpis?.lowStock || 0), sub: 'Items below reorder', icon: AlertTriangle, color: 'text-destructive' },
    { label: 'Purchases (MTD)', value: formatCurrency(kpis?.purchasesMonth || 0), sub: `${kpis?.pendingOrders || 0} pending`, icon: Truck, color: 'text-primary' },
    { label: 'Customers', value: formatNumber(kpis?.customers || 0), sub: 'Active', icon: Users, color: 'text-accent' },
    { label: 'Est. Profit', value: formatCurrency(kpis?.profit || 0), sub: 'Monthly estimate', icon: ShoppingBag, color: 'text-success' },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="min-w-0">
          <p className="section-label mb-0.5">Overview</p>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Sales, stock & customers at a glance</p>
        </div>
        <Badge variant="secondary" className="h-7 rounded-full px-2.5 text-[11px] font-medium shrink-0">
          {isFetching ? 'Refreshing…' : navigator.onLine ? 'Live' : 'Offline'}
        </Badge>
      </div>

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

      <div className="grid gap-2 sm:gap-2.5 grid-cols-2 xl:grid-cols-4 min-w-0">
        {cards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03, type: 'spring', stiffness: 320, damping: 28 }}
            className="kpi-card"
          >
            <div className="flex items-start justify-between relative z-[1] gap-1.5">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] sm:text-xs font-medium text-muted-foreground truncate">{card.label}</p>
                <p className="mt-0.5 text-sm sm:text-lg font-bold tabular-nums tracking-tight font-display truncate">
                  {isLoading ? '—' : card.value}
                </p>
                <p className="mt-0.5 text-[10px] sm:text-xs text-muted-foreground truncate">{card.sub}</p>
              </div>
              <div
                className={`rounded-lg sm:rounded-xl bg-gradient-to-br from-muted to-muted/40 p-1.5 sm:p-2 ring-1 ring-border/60 shrink-0 ${card.color}`}
              >
                <card.icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

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
