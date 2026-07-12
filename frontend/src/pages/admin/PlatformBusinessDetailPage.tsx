import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Shield,
} from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { type CredentialUser, statusVariant } from './platformTypes';

/**
 * Super Admin — single business detail / edit screen.
 */
export function PlatformBusinessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = !!user?.roles?.includes('SUPER_ADMIN');
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [showPasswords, setShowPasswords] = useState(true);
  const [customPw, setCustomPw] = useState<Record<string, string>>({});
  const [revealedPw, setRevealedPw] = useState<Record<string, string>>({});
  const credentialsRef = useRef<HTMLDivElement | null>(null);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['platform-company', id],
    enabled: isSuperAdmin && !!id,
    queryFn: async () => (await api.get(`/platform/companies/${id}`)).data.data,
  });

  useEffect(() => {
    if (searchParams.get('tab') === 'passwords' && detail) {
      window.setTimeout(() => {
        credentialsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Revenue 30d', value: formatCurrency(detail.metrics.revenue30d) },
              { label: 'Sales 30d', value: formatNumber(detail.metrics.salesCount30d) },
              { label: 'Inventory value', value: formatCurrency(detail.metrics.inventoryValue) },
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
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
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
                        {formatCurrency(p.revenue)}
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
