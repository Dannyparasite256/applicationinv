import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
  Search,
  Shield,
  Activity,
  Ban,
  CheckCircle2,
  Clock,
  Eye,
  RefreshCw,
  Store,
  ChevronLeft,
  ChevronRight,
  Mail,
  Phone,
  MapPin,
  KeyRound,
  Copy,
  EyeOff,
} from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Navigate } from 'react-router-dom';

type CredentialUser = {
  id: string;
  email: string;
  loginEmail?: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  status: string;
  lastLoginAt?: string | null;
  roles: Array<{ code: string; name: string }>;
  knownPassword?: string | null;
  passwordSetAt?: string | null;
  hasKnownPassword?: boolean;
  note?: string;
};

type OwnerInfo = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  status: string;
  lastLoginAt?: string | null;
  role: string;
};

type CompanyRow = {
  id: string;
  name: string;
  slug: string;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  address?: string | null;
  status: string;
  currency?: string;
  createdAt: string;
  trialEndsAt?: string | null;
  _count: {
    users: number;
    products: number;
    sales: number;
    customers: number;
    branches: number;
  };
  primaryOwner?: OwnerInfo | null;
  owners?: OwnerInfo[];
  metrics: {
    revenue30d: number;
    sales30d: number;
    lastActivityAt?: string;
  };
};

const statusVariant = (s: string): 'success' | 'warning' | 'destructive' | 'secondary' | 'default' => {
  if (s === 'ACTIVE') return 'success';
  if (s === 'TRIAL') return 'warning';
  if (s === 'SUSPENDED' || s === 'CANCELLED') return 'destructive';
  return 'secondary';
};

export function PlatformAdminPage() {
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = !!user?.roles?.includes('SUPER_ADMIN');
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [showPasswords, setShowPasswords] = useState(true);
  const [customPw, setCustomPw] = useState<Record<string, string>>({});
  const [revealedPw, setRevealedPw] = useState<Record<string, string>>({});
  const [panelMode, setPanelMode] = useState<'overview' | 'passwords'>('overview');
  const credentialsRef = useRef<HTMLDivElement | null>(null);
  const pageSize = 50;

  const openBusinessPasswords = (companyId: string) => {
    setSelectedId(companyId);
    setPanelMode('passwords');
    setShowPasswords(true);
    // Scroll after detail loads
    window.setTimeout(() => {
      credentialsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 350);
  };

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [status]);

  const { data: overview, isLoading: loadingOverview, refetch: refetchOverview } = useQuery({
    queryKey: ['platform-overview'],
    enabled: isSuperAdmin,
    queryFn: async () => (await api.get('/platform/overview')).data.data,
    refetchInterval: 60_000,
  });

  const { data: companiesRes, isLoading: loadingCompanies, refetch: refetchCompanies, isError: companiesError, error: companiesErr } = useQuery({
    queryKey: ['platform-companies', debouncedSearch, status, page],
    enabled: isSuperAdmin,
    queryFn: async () =>
      (
        await api.get('/platform/companies', {
          params: {
            search: debouncedSearch || undefined,
            status: status || undefined,
            page,
            limit: pageSize,
            sortBy: 'createdAt',
            sortOrder: 'desc',
          },
        })
      ).data as {
        data: CompanyRow[];
        meta: { total: number; page: number; limit: number; totalPages: number };
      },
  });

  const { data: activity } = useQuery({
    queryKey: ['platform-activity'],
    enabled: isSuperAdmin,
    queryFn: async () => (await api.get('/platform/activity', { params: { limit: 20 } })).data.data,
  });

  const { data: detail, isLoading: loadingDetail } = useQuery({
    queryKey: ['platform-company', selectedId],
    enabled: isSuperAdmin && !!selectedId,
    queryFn: async () => (await api.get(`/platform/companies/${selectedId}`)).data.data,
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, newStatus }: { id: string; newStatus: string }) =>
      api.patch(`/platform/companies/${id}/status`, { status: newStatus, note: note || undefined }),
    onSuccess: () => {
      toast.success('Business status updated');
      setNote('');
      qc.invalidateQueries({ queryKey: ['platform-companies'] });
      qc.invalidateQueries({ queryKey: ['platform-overview'] });
      qc.invalidateQueries({ queryKey: ['platform-company', selectedId] });
      qc.invalidateQueries({ queryKey: ['platform-activity'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({
      companyId,
      userId,
      password,
    }: {
      companyId: string;
      userId: string;
      password?: string;
    }) =>
      (
        await api.post(`/platform/companies/${companyId}/users/${userId}/password`, {
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
      qc.invalidateQueries({ queryKey: ['platform-company', selectedId] });
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

  const kpis = overview?.kpis;
  const companies = companiesRes?.data || [];
  const totalCompanies = companiesRes?.meta?.total ?? kpis?.totalCompanies ?? 0;
  const totalPages = Math.max(1, companiesRes?.meta?.totalPages || Math.ceil(totalCompanies / pageSize) || 1);

  const kpiCards = useMemo(
    () => [
      { label: 'All businesses', value: formatNumber(kpis?.totalCompanies || 0), sub: `${kpis?.activeCompanies || 0} active · ${kpis?.trialCompanies || 0} trial`, icon: Building2, color: 'text-primary' },
      { label: 'On Trial', value: formatNumber(kpis?.trialCompanies || 0), sub: `${kpis?.newThisWeek || 0} new this week`, icon: Clock, color: 'text-warning' },
      { label: 'Suspended', value: formatNumber(kpis?.suspendedCompanies || 0), sub: 'Need attention', icon: Ban, color: 'text-destructive' },
      { label: 'Platform Users', value: formatNumber(kpis?.totalUsers || 0), sub: `${formatNumber(kpis?.totalProducts || 0)} products`, icon: Users, color: 'text-accent' },
      { label: 'GMV (30d)', value: formatCurrency(kpis?.gmv30d || 0), sub: `${formatNumber(kpis?.salesCount30d || 0)} sales`, icon: DollarSign, color: 'text-success' },
      { label: 'All-time Sales', value: formatNumber(kpis?.totalSales || 0), sub: 'Completed transactions', icon: Store, color: 'text-primary' },
    ],
    [kpis]
  );

  if (!isSuperAdmin) {
    return <Navigate to="/app" replace />;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" />
            <h1 className="page-title">All Businesses</h1>
          </div>
          <p className="page-subtitle">
            Super Admin directory — use <strong>Passwords</strong> to view/change logins.
          </p>
        </div>
        <div className="page-actions">
          <Badge variant="secondary">Super Admin</Badge>
          <Badge variant="outline">{formatNumber(kpis?.totalCompanies || totalCompanies)} total</Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void refetchOverview();
              void refetchCompanies();
            }}
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 2xl:grid-cols-6 min-w-0">
        {kpiCards.map((card) => (
          <div key={card.label} className="kpi-card">
            <div className="flex items-start justify-between gap-1.5 min-w-0">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{card.label}</p>
                <p className="mt-0.5 text-sm sm:text-lg font-bold tabular-nums truncate">
                  {loadingOverview ? '—' : card.value}
                </p>
                <p className="mt-0.5 text-[10px] sm:text-xs text-muted-foreground truncate">{card.sub}</p>
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
                <AreaChart data={overview?.registrationTrend || []} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
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
                  <Area type="monotone" dataKey="count" stroke="hsl(221 83% 53%)" fill="url(#regFill)" strokeWidth={2} />
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
                <BarChart data={overview?.statusBreakdown || []} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
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

      {/* Filters + directory of every registered business */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Business directory</CardTitle>
              <CardDescription>
                Showing {companies.length} of {formatNumber(totalCompanies)} registered{' '}
                {totalCompanies === 1 ? 'business' : 'businesses'} · click to open monitoring
              </CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
              <div className="relative flex-1 sm:w-72">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search name, email, slug, city, phone..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="TRIAL">Trial</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="EXPIRED">Expired</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {companiesError && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Could not load businesses: {getErrorMessage(companiesErr)}
            </p>
          )}

          {/* Mobile-friendly cards */}
          <div className="grid gap-3 md:hidden">
            {loadingCompanies && (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading businesses…</p>
            )}
            {!loadingCompanies && companies.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No businesses registered yet
              </p>
            )}
            {companies.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={`text-left rounded-xl border p-3 transition-colors ${
                  selectedId === c.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.slug}</p>
                  </div>
                  <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                </div>
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {(c.primaryOwner || c.email) && (
                    <p className="flex items-center gap-1.5 truncate">
                      <Mail className="h-3 w-3 shrink-0" />
                      {c.primaryOwner
                        ? `${c.primaryOwner.firstName} ${c.primaryOwner.lastName} · ${c.primaryOwner.email}`
                        : c.email}
                    </p>
                  )}
                  {(c.phone || c.primaryOwner?.phone) && (
                    <p className="flex items-center gap-1.5">
                      <Phone className="h-3 w-3 shrink-0" />
                      {c.phone || c.primaryOwner?.phone}
                    </p>
                  )}
                  <p className="flex items-center gap-1.5">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {[c.city, c.country].filter(Boolean).join(', ') || '—'}
                  </p>
                  <p>
                    {c._count.users} users · {c._count.products} products ·{' '}
                    {formatCurrency(c.metrics.revenue30d, c.currency || 'USD')} GMV (30d)
                  </p>
                  <p>Joined {formatDate(c.createdAt)}</p>
                  <div className="flex gap-2 pt-2" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1"
                      onClick={() => openBusinessPasswords(c.id)}
                    >
                      <KeyRound className="h-3.5 w-3.5" /> Passwords
                    </Button>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block table-scroll rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Business</th>
                  <th className="px-4 py-3 font-medium">Owner / contact</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Users</th>
                  <th className="px-4 py-3 font-medium text-right">Products</th>
                  <th className="px-4 py-3 font-medium text-right">Sales 30d</th>
                  <th className="px-4 py-3 font-medium text-right">GMV 30d</th>
                  <th className="px-4 py-3 font-medium">Registered</th>
                  <th className="px-4 py-3 font-medium">Last activity</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadingCompanies && (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-muted-foreground">
                      Loading businesses...
                    </td>
                  </tr>
                )}
                {!loadingCompanies && companies.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-muted-foreground">
                      No businesses found
                    </td>
                  </tr>
                )}
                {companies.map((c) => (
                  <tr
                    key={c.id}
                    className={`border-b border-border/60 hover:bg-muted/30 cursor-pointer ${
                      selectedId === c.id ? 'bg-primary/5' : ''
                    }`}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.slug}
                        {c.email ? ` · ${c.email}` : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[c.city, c.country].filter(Boolean).join(', ') || '—'}
                        {c.currency ? ` · ${c.currency}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {c.primaryOwner ? (
                        <>
                          <p className="font-medium">
                            {c.primaryOwner.firstName} {c.primaryOwner.lastName}
                          </p>
                          <p className="text-xs text-muted-foreground">{c.primaryOwner.email}</p>
                          {c.primaryOwner.phone && (
                            <p className="text-xs text-muted-foreground">{c.primaryOwner.phone}</p>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {c.email || c.phone || 'No owner on file'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{c._count.users}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{c._count.products}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.metrics.sales30d}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">
                      {formatCurrency(c.metrics.revenue30d, c.currency || 'USD')}
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">{formatDate(c.createdAt)}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {c.metrics.lastActivityAt ? formatDate(c.metrics.lastActivityAt) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPanelMode('overview');
                            setSelectedId(c.id);
                          }}
                        >
                          <Eye className="h-3.5 w-3.5" /> Monitor
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          title="View / change login passwords for this business"
                          onClick={(e) => {
                            e.stopPropagation();
                            openBusinessPasswords(c.id);
                          }}
                        >
                          <KeyRound className="h-3.5 w-3.5" /> Passwords
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1 || loadingCompanies}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages || loadingCompanies}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Detail panel */}
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">
              {detail?.company?.name || 'Business detail'}
            </CardTitle>
            <CardDescription>
              {selectedId
                ? 'Live operational snapshot for this tenant'
                : 'Select a business from the table to monitor it'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedId && (
              <div className="py-16 text-center text-muted-foreground text-sm">
                <Building2 className="mx-auto h-10 w-10 mb-3 opacity-40" />
                Choose a registered business to view users, sales, inventory and audit activity.
              </div>
            )}
            {selectedId && loadingDetail && (
              <p className="text-sm text-muted-foreground">Loading business intelligence…</p>
            )}
            {detail && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusVariant(detail.company.status)}>{detail.company.status}</Badge>
                  <span className="text-xs text-muted-foreground font-mono">{detail.company.slug}</span>
                  <span className="text-xs text-muted-foreground">
                    Joined {formatDate(detail.company.createdAt)}
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    { label: 'Revenue 30d', value: formatCurrency(detail.metrics.revenue30d) },
                    { label: 'Sales 30d', value: formatNumber(detail.metrics.salesCount30d) },
                    { label: 'Inventory value', value: formatCurrency(detail.metrics.inventoryValue) },
                    { label: 'Users / Products', value: `${detail.metrics.users} / ${detail.metrics.products}` },
                  ].map((m) => (
                    <div key={m.label} className="rounded-xl border border-border p-3">
                      <p className="text-xs text-muted-foreground">{m.label}</p>
                      <p className="text-lg font-bold tabular-nums mt-1">{m.value}</p>
                    </div>
                  ))}
                </div>

                <div className="h-48">
                  <p className="text-sm font-medium mb-2">Sales trend (14 days)</p>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={detail.salesTrend || []}>
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} />
                      <Area type="monotone" dataKey="sales" stroke="hsl(142 71% 45%)" fill="hsl(142 71% 45% / 0.2)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <p className="text-sm font-medium mb-2">Owners / admins</p>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
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
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">Top products (30d)</p>
                    <div className="space-y-2">
                      {(detail.topProducts || []).map(
                        (p: { name: string; revenue: number; quantity: number }, i: number) => (
                          <div key={i} className="flex justify-between text-sm">
                            <span className="truncate pr-2">{p.name}</span>
                            <span className="tabular-nums font-medium">{formatCurrency(p.revenue)}</span>
                          </div>
                        )
                      )}
                      {!detail.topProducts?.length && (
                        <p className="text-xs text-muted-foreground">No sales yet</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Login credentials — super admin can view & change passwords for any business */}
                <div
                  ref={credentialsRef}
                  className={`rounded-xl border p-4 space-y-3 ${
                    panelMode === 'passwords'
                      ? 'border-primary ring-2 ring-primary/30 bg-primary/10'
                      : 'border-primary/25 bg-primary/5'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium flex items-center gap-2">
                        <KeyRound className="h-4 w-4 text-primary" />
                        Login credentials &amp; password control
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Super Admin can view login emails and set/edit passwords for every user on
                        this business. Use <strong>Reset / generate</strong> or type a custom
                        password. Passwords users chose themselves cannot be recovered — only
                        admin-set ones are stored for support.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowPasswords((v) => !v)}
                    >
                      {showPasswords ? (
                        <>
                          <EyeOff className="h-3.5 w-3.5" /> Hide passwords
                        </>
                      ) : (
                        <>
                          <Eye className="h-3.5 w-3.5" /> Show passwords
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="table-scroll rounded-xl border border-border bg-card">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/40 text-left text-muted-foreground">
                          <th className="px-3 py-2">User</th>
                          <th className="px-3 py-2">Login (email)</th>
                          <th className="px-3 py-2">Password</th>
                          <th className="px-3 py-2">Roles</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {((detail.credentials || detail.users || []) as CredentialUser[]).map(
                          (u) => {
                            const pw =
                              revealedPw[u.id] ||
                              (u.knownPassword as string | null | undefined) ||
                              null;
                            return (
                              <tr key={u.id} className="border-t border-border/60 align-top">
                                <td className="px-3 py-2">
                                  <p className="font-medium">
                                    {u.firstName} {u.lastName}
                                  </p>
                                  <p className="text-muted-foreground">
                                    Last login:{' '}
                                    {u.lastLoginAt ? formatDate(u.lastLoginAt) : 'never'}
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
                                      title="Copy email"
                                      onClick={() =>
                                        void copyText('Email', u.loginEmail || u.email)
                                      }
                                    >
                                      <Copy className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </td>
                                <td className="px-3 py-2 min-w-[140px]">
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
                                    <span className="text-muted-foreground italic">
                                      Not stored — reset to view
                                    </span>
                                  )}
                                  {u.passwordSetAt && (
                                    <p className="text-[10px] text-muted-foreground mt-0.5">
                                      Set {formatDate(u.passwordSetAt)}
                                    </p>
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
                                  <div className="flex flex-col gap-1.5 min-w-[160px]">
                                    <Input
                                      type="text"
                                      className="h-8 text-xs"
                                      placeholder="Custom password (optional)"
                                      value={customPw[u.id] || ''}
                                      onChange={(e) =>
                                        setCustomPw((prev) => ({
                                          ...prev,
                                          [u.id]: e.target.value,
                                        }))
                                      }
                                    />
                                    <div className="flex flex-wrap gap-1">
                                      <Button
                                        size="sm"
                                        variant="default"
                                        loading={
                                          resetPasswordMutation.isPending &&
                                          resetPasswordMutation.variables?.userId === u.id &&
                                          !!customPw[u.id]?.trim()
                                        }
                                        disabled={!customPw[u.id]?.trim() || customPw[u.id].trim().length < 8}
                                        onClick={() =>
                                          resetPasswordMutation.mutate({
                                            companyId: detail.company.id,
                                            userId: u.id,
                                            password: customPw[u.id]?.trim(),
                                          })
                                        }
                                      >
                                        <KeyRound className="h-3 w-3" />
                                        Save password
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        loading={
                                          resetPasswordMutation.isPending &&
                                          resetPasswordMutation.variables?.userId === u.id &&
                                          !customPw[u.id]?.trim()
                                        }
                                        onClick={() =>
                                          resetPasswordMutation.mutate({
                                            companyId: detail.company.id,
                                            userId: u.id,
                                          })
                                        }
                                      >
                                        Generate new
                                      </Button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            );
                          }
                        )}
                      </tbody>
                    </table>
                  </div>
                  {!detail.credentials?.length && !detail.users?.length && (
                    <p className="text-xs text-muted-foreground">No users on this business yet.</p>
                  )}
                </div>

                <div className="rounded-xl border border-border p-4 space-y-3 bg-muted/20">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Shield className="h-4 w-4" /> Platform controls
                  </p>
                  <Input
                    placeholder="Optional note for status change (visible in audit + notification)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="success"
                      loading={statusMutation.isPending}
                      onClick={() =>
                        statusMutation.mutate({ id: detail.company.id, newStatus: 'ACTIVE' })
                      }
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Activate
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={statusMutation.isPending}
                      onClick={() =>
                        statusMutation.mutate({ id: detail.company.id, newStatus: 'TRIAL' })
                      }
                    >
                      Set Trial
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      loading={statusMutation.isPending}
                      onClick={() =>
                        statusMutation.mutate({ id: detail.company.id, newStatus: 'SUSPENDED' })
                      }
                    >
                      <Ban className="h-3.5 w-3.5" /> Suspend
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={statusMutation.isPending}
                      onClick={() =>
                        statusMutation.mutate({ id: detail.company.id, newStatus: 'CANCELLED' })
                      }
                    >
                      Cancel
                    </Button>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">Tenant audit trail</p>
                  <div className="space-y-2 max-h-56 overflow-y-auto">
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
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" /> Platform activity
            </CardTitle>
            <CardDescription>Recent cross-tenant audit events</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 max-h-[720px] overflow-y-auto">
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

      {/* Recent signups strip */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Latest registrations</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                className="text-left rounded-xl border border-border p-3 hover:border-primary/50 transition-colors"
                onClick={() => setSelectedId(c.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium truncate">{c.name}</p>
                  <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{c.slug}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  {c._count.users} users · {c._count.products} products · {c._count.sales} sales
                </p>
                <p className="text-xs text-muted-foreground">{formatDate(c.createdAt)}</p>
              </button>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
