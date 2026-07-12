import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  ChevronLeft,
  ChevronRight,
  Mail,
  MapPin,
  Phone,
  Search,
  Shield,
} from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { type CompanyRow, statusVariant } from './platformTypes';

/**
 * Super Admin — searchable business directory (own screen).
 * Tap a business → /app/platform/businesses/:id
 */
export function PlatformBusinessesPage() {
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = !!user?.roles?.includes('SUPER_ADMIN');
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

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

  const {
    data: companiesRes,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
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

  if (!isSuperAdmin) {
    return <Navigate to="/app" replace />;
  }

  const companies = companiesRes?.data || [];
  const total = companiesRes?.meta?.total ?? 0;
  const totalPages = Math.max(
    1,
    companiesRes?.meta?.totalPages || Math.ceil(total / pageSize) || 1
  );

  const openBusiness = (id: string, tab?: 'passwords' | 'sales') => {
    if (tab === 'sales') {
      navigate(`/app/platform/businesses/${id}/sales`);
      return;
    }
    navigate(`/app/platform/businesses/${id}${tab ? `?tab=${tab}` : ''}`);
  };

  return (
    <div className="page-container fit-x pb-6 space-y-4">
      <div className="flex items-start gap-2">
        <Link
          to="/app/platform"
          aria-label="Back to platform overview"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-muted mt-0.5"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary shrink-0" />
            <h1 className="text-xl sm:text-2xl font-bold truncate">Business directory</h1>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Search and open any registered business · {formatNumber(total)} total
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          loading={isFetching}
          onClick={() => void refetch()}
        >
          Refresh
        </Button>
      </div>

      {/* Sticky-ish search bar */}
      <Card>
        <CardContent className="p-3 sm:p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-9 h-11 text-base sm:text-sm"
              placeholder="Search name, email, slug, city, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <select
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm min-w-[10rem]"
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
            {debouncedSearch && (
              <Badge variant="secondary" className="h-8">
                Filter: “{debouncedSearch}”
              </Badge>
            )}
            {(debouncedSearch || status) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setStatus('');
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All businesses</CardTitle>
          <CardDescription>
            Showing {companies.length} of {formatNumber(total)} · Open for details · Sales for that business’s sales
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isError && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Could not load businesses: {getErrorMessage(error)}
            </p>
          )}

          {/* Mobile cards */}
          <div className="grid gap-2.5 md:hidden">
            {isLoading && (
              <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
            )}
            {!isLoading && companies.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No businesses match your search
              </p>
            )}
            {companies.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => openBusiness(c.id)}
                className="text-left rounded-xl border border-border p-3.5 hover:border-primary/50 hover:bg-primary/5 transition-colors active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground truncate font-mono">{c.slug}</p>
                  </div>
                  <Badge variant={statusVariant(c.status)} className="shrink-0">
                    {c.status}
                  </Badge>
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
                    {formatNumber(c._count.sales)} sales ·{' '}
                    {formatCurrency(c.metrics.revenue30d, c.currency || 'USD')} GMV (30d)
                  </p>
                </div>
                <div className="mt-2.5 flex gap-2" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => openBusiness(c.id)}
                  >
                    Open / edit
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openBusiness(c.id, 'sales')}
                  >
                    Sales
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openBusiness(c.id, 'passwords')}
                  >
                    Passwords
                  </Button>
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
                  <th className="px-4 py-3 font-medium text-right">Sales</th>
                  <th className="px-4 py-3 font-medium text-right">GMV 30d</th>
                  <th className="px-4 py-3 font-medium">Registered</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                      Loading businesses…
                    </td>
                  </tr>
                )}
                {!isLoading && companies.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                      No businesses found
                    </td>
                  </tr>
                )}
                {companies.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-border/60 hover:bg-muted/30 cursor-pointer"
                    onClick={() => openBusiness(c.id)}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {c.slug}
                        {c.email ? ` · ${c.email}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {c.primaryOwner ? (
                        <>
                          <p className="font-medium">
                            {c.primaryOwner.firstName} {c.primaryOwner.lastName}
                          </p>
                          <p className="text-xs text-muted-foreground">{c.primaryOwner.email}</p>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {c.email || c.phone || '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{c._count.users}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{c._count.products}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <button
                        type="button"
                        className="text-primary font-medium hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          openBusiness(c.id, 'sales');
                        }}
                      >
                        {formatNumber(c._count.sales)}
                      </button>
                      <p className="text-[10px] text-muted-foreground">
                        {c.metrics.sales30d} / 30d
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">
                      {formatCurrency(c.metrics.revenue30d, c.currency || 'USD')}
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {formatDate(c.createdAt)}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" onClick={() => openBusiness(c.id)}>
                          Open
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => openBusiness(c.id, 'sales')}
                        >
                          Sales
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => openBusiness(c.id, 'passwords')}
                        >
                          Passwords
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
                  disabled={page <= 1 || isLoading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages || isLoading}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-center text-muted-foreground flex items-center justify-center gap-1">
        <Shield className="h-3 w-3" /> Super Admin only
      </p>
    </div>
  );
}
