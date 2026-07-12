import { useMemo } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Building2,
  Users,
  DollarSign,
  Shield,
  Activity,
  Ban,
  Clock,
  RefreshCw,
  Store,
  ChevronRight,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { statusVariant } from './platformTypes';

/**
 * Super Admin overview hub.
 * Business directory lives at /app/platform/businesses
 * Single business edit at /app/platform/businesses/:id
 */
export function PlatformAdminPage() {
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = !!user?.roles?.includes('SUPER_ADMIN');
  const navigate = useNavigate();

  const { data: overview, isLoading: loadingOverview, refetch: refetchOverview } = useQuery({
    queryKey: ['platform-overview'],
    enabled: isSuperAdmin,
    queryFn: async () => (await api.get('/platform/overview')).data.data,
    refetchInterval: 60_000,
  });

  const { data: activity } = useQuery({
    queryKey: ['platform-activity'],
    enabled: isSuperAdmin,
    queryFn: async () => (await api.get('/platform/activity', { params: { limit: 20 } })).data.data,
  });

  const kpis = overview?.kpis;

  const kpiCards = useMemo(
    () => [
      {
        label: 'All businesses',
        value: formatNumber(kpis?.totalCompanies || 0),
        sub: `${kpis?.activeCompanies || 0} active · ${kpis?.trialCompanies || 0} trial`,
        icon: Building2,
        color: 'text-primary',
      },
      {
        label: 'On Trial',
        value: formatNumber(kpis?.trialCompanies || 0),
        sub: `${kpis?.newThisWeek || 0} new this week`,
        icon: Clock,
        color: 'text-warning',
      },
      {
        label: 'Suspended',
        value: formatNumber(kpis?.suspendedCompanies || 0),
        sub: 'Need attention',
        icon: Ban,
        color: 'text-destructive',
      },
      {
        label: 'Platform Users',
        value: formatNumber(kpis?.totalUsers || 0),
        sub: `${formatNumber(kpis?.totalProducts || 0)} products`,
        icon: Users,
        color: 'text-accent',
      },
      {
        label: 'GMV (30d)',
        value: formatCurrency(kpis?.gmv30d || 0),
        sub: `${formatNumber(kpis?.salesCount30d || 0)} sales`,
        icon: DollarSign,
        color: 'text-success',
      },
      {
        label: 'All-time Sales',
        value: formatNumber(kpis?.totalSales || 0),
        sub: 'Completed transactions',
        icon: Store,
        color: 'text-primary',
      },
    ],
    [kpis]
  );

  if (!isSuperAdmin) {
    return <Navigate to="/app" replace />;
  }

  return (
    <div className="page-container fit-x pb-6 space-y-4">
      <div className="page-header">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" />
            <h1 className="page-title">Platform overview</h1>
          </div>
          <p className="page-subtitle">Super Admin · monitor every business on the platform</p>
        </div>
        <div className="page-actions">
          <Badge variant="secondary">Super Admin</Badge>
          <Badge variant="outline">{formatNumber(kpis?.totalCompanies || 0)} total</Badge>
          <Button variant="outline" size="sm" onClick={() => void refetchOverview()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      {/* Entry to full directory */}
      <Link
        to="/app/platform/businesses"
        className="flex items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary/5 px-4 py-4 hover:bg-primary/10 transition-colors min-h-[3.5rem]"
      >
        <div className="min-w-0 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold">Business directory</p>
            <p className="text-xs text-muted-foreground">
              Search all businesses · open one to edit status & passwords
            </p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-primary shrink-0" />
      </Link>

      {/* Health / attention board */}
      <Card className="border-warning/30 bg-warning/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Needs attention</CardTitle>
          <CardDescription>Businesses that may need support</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">Suspended</p>
            <p className="text-xl font-bold tabular-nums text-destructive">
              {formatNumber(kpis?.suspendedCompanies || 0)}
            </p>
            <Link to="/app/platform/businesses" className="text-[11px] text-primary font-medium">
              Open directory →
            </Link>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">On trial</p>
            <p className="text-xl font-bold tabular-nums text-warning">
              {formatNumber(kpis?.trialCompanies || 0)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {formatNumber(kpis?.newThisWeek || 0)} new this week
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">Support tip</p>
            <p className="text-xs mt-1 text-muted-foreground leading-relaxed">
              Open a business → reset passwords, change status, review audit trail. No silent
              login-as; use credentials tools only.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 2xl:grid-cols-6 min-w-0">
        {kpiCards.map((card) => (
          <div key={card.label} className="kpi-card">
            <div className="flex items-start justify-between gap-1.5 min-w-0">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{card.label}</p>
                <p className="mt-0.5 text-sm sm:text-lg font-bold tabular-nums truncate">
                  {loadingOverview ? '—' : card.value}
                </p>
                <p className="mt-0.5 text-[10px] sm:text-xs text-muted-foreground truncate">
                  {card.sub}
                </p>
              </div>
              <div className={`rounded-lg bg-muted p-1.5 sm:p-2 shrink-0 ${card.color}`}>
                <card.icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-2.5 sm:gap-3 xl:grid-cols-3 min-w-0">
        <Card className="xl:col-span-2 fit-x">
          <CardHeader>
            <CardTitle className="text-base">Business registrations (14 days)</CardTitle>
            <CardDescription>New companies joining the platform</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={overview?.registrationTrend || []}
                  margin={{ top: 4, right: 4, left: -12, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="regFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(221 83% 53%)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(221 83% 53%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={32} />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="hsl(221 83% 53%)"
                    fill="url(#regFill)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="fit-x">
          <CardHeader>
            <CardTitle className="text-base">Status breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="chart-box-sm">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={overview?.statusBreakdown || []}
                  margin={{ top: 4, right: 4, left: -12, bottom: 0 }}
                >
                  <XAxis dataKey="status" tick={{ fontSize: 9 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={28} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(199 89% 48%)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Latest registrations</CardTitle>
              <CardDescription>Tap to open business edit screen</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => navigate('/app/platform/businesses')}>
              View all
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {(overview?.recentCompanies || []).map(
              (c: {
                id: string;
                name: string;
                slug: string;
                status: string;
                createdAt: string;
                _count: { users: number; products: number; sales: number };
              }) => (
                <button
                  key={c.id}
                  type="button"
                  className="text-left rounded-xl border border-border p-3 hover:border-primary/50 transition-colors"
                  onClick={() => navigate(`/app/platform/businesses/${c.id}`)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium truncate">{c.name}</p>
                    <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 font-mono">{c.slug}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {c._count.users} users · {c._count.products} products · {c._count.sales} sales
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDate(c.createdAt)}</p>
                </button>
              )
            )}
            {!overview?.recentCompanies?.length && (
              <p className="text-sm text-muted-foreground col-span-2 py-8 text-center">
                No registrations yet
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" /> Platform activity
            </CardTitle>
            <CardDescription>Recent cross-tenant events</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 max-h-[420px] overflow-y-auto">
            {(activity || []).map(
              (log: {
                id: string;
                action: string;
                module: string;
                createdAt: string;
                company?: { name: string; slug: string } | null;
                user?: { email?: string; firstName?: string; lastName?: string } | null;
              }) => (
                <div key={log.id} className="rounded-lg border border-border p-3 text-sm">
                  <p className="font-medium">{log.action}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {log.company?.name || 'Platform'} · {log.module}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {log.user?.email || 'system'} · {formatDate(log.createdAt)}
                  </p>
                </div>
              )
            )}
            {!activity?.length && (
              <p className="text-sm text-muted-foreground py-8 text-center">No recent activity</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
