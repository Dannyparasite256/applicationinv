import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  UserCheck,
  UserX,
  Plus,
  Shield,
  Clock,
  Users,
  Pencil,
  Trash2,
  KeyRound,
  Copy,
  RefreshCw,
  X,
  Lock,
  CheckSquare,
  Square,
} from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { isManager } from '@/lib/roleAccess';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Navigate } from 'react-router-dom';

const WORKER_ROLES = [
  'CASHIER',
  'SALES_PERSON',
  'STORE_MANAGER',
  'WAREHOUSE_MANAGER',
  'ACCOUNTANT',
  'PROCUREMENT_OFFICER',
  'PHARMACIST',
  'DOCTOR',
  'NURSE',
  'RECEPTIONIST',
  'LABORATORY_TECHNICIAN',
  'BRANCH_MANAGER',
  'ADMINISTRATOR',
];

/** Friendly labels for staff access checkboxes */
const FEATURE_LABELS: Record<string, string> = {
  'pos.access': 'Point of Sale (POS)',
  'sales.read': 'View sales history',
  'sales.create': 'Create sales / invoices',
  'inventory.products.read': 'View products & stock',
  'inventory.products.create': 'Add products',
  'inventory.products.update': 'Edit products',
  'inventory.products.delete': 'Delete products',
  'inventory.stock.adjust': 'Adjust stock levels',
  'inventory.stock.transfer': 'Transfer stock between warehouses',
  'crm.customers.read': 'View customers',
  'crm.customers.create': 'Add / edit customers',
  'purchases.read': 'View purchases & suppliers',
  'purchases.create': 'Create purchase orders',
  'purchases.update': 'Receive / update purchases',
  'accounting.read': 'View accounting',
  'accounting.write': 'Manage accounting entries',
  'reports.read': 'View reports',
  'settings.company': 'Company settings',
  'users.manage': 'Manage staff & access',
  'hr.employees.read': 'View HR / employees',
  'hospital.patients.read': 'View patients',
  'hospital.patients.create': 'Register patients',
  'hospital.appointments.create': 'Book appointments',
  'pharmacy.dispense': 'Pharmacy dispense',
  'laboratory.read': 'View lab orders',
  'laboratory.create': 'Create lab orders',
};

const MODULE_ORDER = [
  'pos',
  'sales',
  'inventory',
  'crm',
  'purchases',
  'accounting',
  'reports',
  'users',
  'settings',
  'hr',
  'hospital',
  'pharmacy',
  'laboratory',
];

type StaffUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  status: string;
  createdAt: string;
  lastLoginAt?: string | null;
  roles: Array<{ code: string; name: string }>;
};

type PermCatalogItem = {
  id: string;
  code: string;
  name: string;
  module: string;
  action: string;
};

type StaffAccess = {
  userId: string;
  email: string;
  name: string;
  roles: Array<{ code: string; name: string }>;
  rolePermissions: string[];
  effective: string[];
  customized: boolean;
  catalog: PermCatalogItem[];
};

type StaffForm = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  roleCode: string;
};

const emptyForm = (): StaffForm => ({
  email: '',
  password: '',
  firstName: '',
  lastName: '',
  phone: '',
  roleCode: 'CASHIER',
});

export function StaffPage() {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const roles = useAuthStore((s) => s.user?.roles || []);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = isManager(roles) || hasPermission('users.manage');
  const qc = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<StaffForm>(emptyForm());
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [editForm, setEditForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    phone: '',
    roleCode: 'CASHIER',
  });
  const [passwordUser, setPasswordUser] = useState<StaffUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [createdCreds, setCreatedCreds] = useState<{ email: string; password: string } | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [accessUser, setAccessUser] = useState<StaffUser | null>(null);
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set());

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['staff-pending'] });
    qc.invalidateQueries({ queryKey: ['staff-all'] });
    qc.invalidateQueries({ queryKey: ['staff-pending-count'] });
    qc.invalidateQueries({ queryKey: ['users'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['staff-access'] });
  };

  const { data: pendingRes, isLoading: loadingPending } = useQuery({
    enabled: canManage,
    queryKey: ['staff-pending'],
    queryFn: async () =>
      (await api.get('/users', { params: { pending: true, limit: 50 } })).data as {
        data: StaffUser[];
      },
  });

  const { data: allRes, isLoading: loadingAll } = useQuery({
    queryKey: ['staff-all'],
    enabled: canManage,
    queryFn: async () =>
      (await api.get('/users', { params: { limit: 100 } })).data as { data: StaffUser[] },
  });

  const genPassword = useMutation({
    mutationFn: async () => (await api.get('/users/generate-password')).data.data.password as string,
    onSuccess: (pwd) => {
      if (passwordUser) setNewPassword(pwd);
      else setForm((f) => ({ ...f, password: pwd }));
      toast.success('New password generated');
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const create = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {
        email: form.email.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        roleCode: form.roleCode,
      };
      if (form.phone.trim()) body.phone = form.phone.trim();
      if (form.password.trim().length >= 8) body.password = form.password.trim();
      return api.post('/users', body);
    },
    onSuccess: (res) => {
      const data = res.data?.data;
      const pwd = data?.temporaryPassword as string | undefined;
      if (pwd) {
        setCreatedCreds({ email: data.email, password: pwd });
      }
      toast.success(
        data?.pendingApproval
          ? 'Staff created — confirm them below, then share their password'
          : 'Staff created'
      );
      setShowForm(false);
      setForm(emptyForm());
      // Background refresh only — response already has the new staff
      refreshAll();
    },
    onError: (e) => {
      const msg = getErrorMessage(e);
      if (/already exists|already registered|conflict/i.test(msg)) {
        toast.message('That email is already on the team', {
          description: 'Confirm them if pending, or use a different email.',
        });
        refreshAll();
        return;
      }
      toast.error(msg);
    },
  });

  const update = useMutation({
    mutationFn: async () =>
      api.put(`/users/${editing!.id}`, {
        email: editForm.email.trim(),
        firstName: editForm.firstName.trim(),
        lastName: editForm.lastName.trim(),
        phone: editForm.phone.trim() || null,
        roleCode: editForm.roleCode,
      }),
    onSuccess: () => {
      toast.success('Staff details updated');
      setEditing(null);
      refreshAll();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const setPassword = useMutation({
    mutationFn: async () =>
      api.post(`/users/${passwordUser!.id}/password`, {
        password: newPassword.trim().length >= 8 ? newPassword.trim() : undefined,
      }),
    onSuccess: (res) => {
      const pwd = res.data?.data?.temporaryPassword as string;
      toast.success('Password updated — copy and share it with the staff member');
      if (pwd) {
        setNewPassword(pwd);
        setCreatedCreds({ email: passwordUser!.email, password: pwd });
      }
      refreshAll();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => {
      toast.success('Staff deleted — they can no longer login');
      refreshAll();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      setConfirmingId(id);
      // Optimistic UI: remove from pending immediately (staff already confirmed in practice
      // once the request is accepted; if it fails we re-fetch)
      qc.setQueriesData({ queryKey: ['staff-pending'] }, (old: unknown) => {
        if (!old || typeof old !== 'object') return old;
        const o = old as { data?: Array<{ id: string }> };
        if (!Array.isArray(o.data)) return old;
        return { ...o, data: o.data.filter((u) => u.id !== id) };
      });
      qc.setQueriesData({ queryKey: ['staff-all'] }, (old: unknown) => {
        if (!old || typeof old !== 'object') return old;
        const o = old as { data?: Array<{ id: string; status?: string }> };
        if (!Array.isArray(o.data)) return old;
        return {
          ...o,
          data: o.data.map((u) => (u.id === id ? { ...u, status: 'ACTIVE' } : u)),
        };
      });
      return api.post(`/users/${id}/approve`);
    },
    onSuccess: () => {
      toast.success('Staff confirmed — they can login with their credentials');
      setConfirmingId(null);
      refreshAll();
    },
    onError: (e) => {
      setConfirmingId(null);
      toast.error(getErrorMessage(e));
      refreshAll();
    },
  });

  const reject = useMutation({
    mutationFn: async (id: string) =>
      api.post(`/users/${id}/reject`, { reason: 'Not approved by manager' }),
    onSuccess: () => {
      toast.message('Staff rejected');
      refreshAll();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const { data: accessData, isLoading: loadingAccess } = useQuery({
    enabled: !!accessUser,
    queryKey: ['staff-access', accessUser?.id],
    queryFn: async () =>
      (await api.get(`/users/${accessUser!.id}/permissions`)).data.data as StaffAccess,
  });

  useEffect(() => {
    if (accessData?.effective) {
      setSelectedPerms(new Set(accessData.effective));
    }
  }, [accessData]);

  const saveAccess = useMutation({
    mutationFn: async () =>
      api.put(`/users/${accessUser!.id}/permissions`, {
        permissions: Array.from(selectedPerms),
      }),
    onSuccess: () => {
      toast.success('Staff access updated — changes apply on their next login / refresh');
      refreshAll();
      setAccessUser(null);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const resetAccess = useMutation({
    mutationFn: async () => api.post(`/users/${accessUser!.id}/permissions/reset`),
    onSuccess: (res) => {
      const data = res.data?.data as StaffAccess | undefined;
      if (data?.effective) setSelectedPerms(new Set(data.effective));
      toast.success('Access reset to role defaults');
      refreshAll();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const permsByModule = useMemo(() => {
    const catalog = accessData?.catalog || [];
    const map = new Map<string, PermCatalogItem[]>();
    for (const p of catalog) {
      const list = map.get(p.module) || [];
      list.push(p);
      map.set(p.module, list);
    }
    const modules = Array.from(map.keys()).sort((a, b) => {
      const ia = MODULE_ORDER.indexOf(a);
      const ib = MODULE_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    return modules.map((m) => ({ module: m, items: map.get(m)! }));
  }, [accessData]);

  const togglePerm = (code: string) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const selectAllInModule = (codes: string[], on: boolean) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      for (const c of codes) {
        if (on) next.add(c);
        else next.delete(c);
      }
      return next;
    });
  };

  const openAccess = (u: StaffUser) => {
    const roleCode = u.roles?.[0]?.code;
    if (roleCode === 'COMPANY_OWNER' || roleCode === 'SUPER_ADMIN') {
      toast.message('Owners and super admins always have full access');
      return;
    }
    setAccessUser(u);
  };

  const pending = pendingRes?.data || [];
  const all = allRes?.data || [];

  if (!canManage) {
    return <Navigate to="/app" replace />;
  }

  const statusBadge = (s: string) => {
    if (s === 'ACTIVE') return <Badge variant="success">ACTIVE</Badge>;
    if (s === 'PENDING_VERIFICATION') return <Badge variant="warning">PENDING APPROVAL</Badge>;
    if (s === 'SUSPENDED' || s === 'INACTIVE') return <Badge variant="destructive">{s}</Badge>;
    return <Badge variant="secondary">{s}</Badge>;
  };

  const openEdit = (u: StaffUser) => {
    setEditing(u);
    setEditForm({
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      phone: u.phone || '',
      roleCode: u.roles?.[0]?.code || 'CASHIER',
    });
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  return (
    <div className="page-container">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" /> Staff Management
          </h1>
          <p className="text-sm text-muted-foreground">
            Create staff, set passwords, and choose which features each person can use.
          </p>
        </div>
        <Button
          onClick={() => {
            setShowForm((v) => !v);
            setForm(emptyForm());
            genPassword.mutate();
          }}
        >
          <Plus className="h-4 w-4" /> Add staff
        </Button>
      </div>

      {/* Credentials banner after create / password reset */}
      {createdCreds && (
        <Card className="border-2 border-success/40 bg-success/5">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base text-success">Share these login credentials</CardTitle>
                <CardDescription>
                  This password is shown once here. Staff use this email + password on the login page.
                </CardDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setCreatedCreds(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
              <span>
                Email: <span className="font-mono font-semibold">{createdCreds.email}</span>
              </span>
              <Button size="sm" variant="outline" onClick={() => copyText(createdCreds.email)}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
              <span>
                Password: <span className="font-mono font-semibold">{createdCreds.password}</span>
              </span>
              <Button size="sm" variant="outline" onClick={() => copyText(createdCreds.password)}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                copyText(`Email: ${createdCreds.email}\nPassword: ${createdCreds.password}`)
              }
            >
              <Copy className="h-3.5 w-3.5" /> Copy both
            </Button>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add new staff member</CardTitle>
            <CardDescription>
              Set their email and password (or auto-generate). After you confirm them, they log in with
              those credentials — nothing is hardcoded.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Input
              placeholder="First name *"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            />
            <Input
              placeholder="Last name *"
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            />
            <Input
              placeholder="Login email *"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <Input
              placeholder="Phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <div className="flex gap-2">
              <Input
                placeholder="Password (min 8) or generate"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="Generate password"
                loading={genPassword.isPending}
                onClick={() => genPassword.mutate()}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            <select
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
              value={form.roleCode}
              onChange={(e) => setForm({ ...form, roleCode: e.target.value })}
            >
              {WORKER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap gap-2">
              <Button
                loading={create.isPending}
                disabled={!form.email || !form.firstName || !form.lastName}
                onClick={() => create.mutate()}
              >
                Create staff
              </Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending confirmation */}
      <Card className="border-2 border-warning/50 shadow-md">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-warning" />
            Waiting for confirmation
            <Badge variant="warning">{pending.length}</Badge>
          </CardTitle>
          <CardDescription>
            Press <strong>Confirm Staff</strong> so they can log in with the email/password you set
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingPending && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loadingPending && pending.length === 0 && (
            <p className="text-sm text-muted-foreground py-4">No staff waiting for confirmation</p>
          )}
          {pending.map((u) => (
            <div
              key={u.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-warning/40 p-4 bg-warning/10"
            >
              <div className="min-w-0">
                <p className="font-semibold text-base">
                  {u.firstName} {u.lastName}
                </p>
                <p className="text-sm font-mono text-muted-foreground">{u.email}</p>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {statusBadge(u.status)}
                  <Badge variant="outline">{u.roles?.map((r) => r.name).join(', ') || 'No role'}</Badge>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <Button
                  size="lg"
                  variant="success"
                  className="font-semibold"
                  loading={approve.isPending && confirmingId === u.id}
                  onClick={() => approve.mutate(u.id)}
                >
                  <UserCheck className="h-5 w-5" /> Confirm Staff
                </Button>
                <Button size="lg" variant="outline" onClick={() => openEdit(u)}>
                  <Pencil className="h-4 w-4" /> Edit
                </Button>
                <Button size="lg" variant="outline" onClick={() => openAccess(u)}>
                  <Lock className="h-4 w-4" /> Access
                </Button>
                <Button size="lg" variant="outline" onClick={() => { setPasswordUser(u); setNewPassword(''); }}>
                  <KeyRound className="h-4 w-4" /> Password
                </Button>
                <Button size="lg" variant="destructive" onClick={() => reject.mutate(u.id)}>
                  <UserX className="h-4 w-4" /> Reject
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* All staff table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" /> All staff
          </CardTitle>
          <CardDescription>
            Edit details, set passwords, or use <strong>Access</strong> to choose which menus and
            actions each staff member can use
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 table-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Login email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last login</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loadingAll && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {all.map((u) => (
                <tr key={u.id} className="border-b border-border/60">
                  <td className="px-4 py-3 font-medium">
                    {u.firstName} {u.lastName}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{u.email}</td>
                  <td className="px-4 py-3 text-xs">{u.roles?.map((r) => r.name).join(', ') || '—'}</td>
                  <td className="px-4 py-3">{statusBadge(u.status)}</td>
                  <td className="px-4 py-3 text-xs">
                    {u.lastLoginAt ? formatDate(u.lastLoginAt) : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.status === 'PENDING_VERIFICATION' && (
                        <Button
                          size="sm"
                          variant="success"
                          className="font-semibold"
                          loading={approve.isPending && confirmingId === u.id}
                          onClick={() => approve.mutate(u.id)}
                        >
                          <UserCheck className="h-3.5 w-3.5" /> Confirm Staff
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => openEdit(u)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openAccess(u)}>
                        <Lock className="h-3.5 w-3.5" /> Access
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setPasswordUser(u);
                          setNewPassword('');
                        }}
                      >
                        <KeyRound className="h-3.5 w-3.5" /> Password
                      </Button>
                      {u.id !== currentUserId && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete ${u.firstName} ${u.lastName}? They will not be able to login.`
                              )
                            ) {
                              remove.mutate(u.id);
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Edit modal */}
      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <Card className="modal-sheet relative z-10 m-0 sm:m-auto" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle className="text-base">Edit staff</CardTitle>
              <CardDescription>Change name, email, phone, or role. Email is their login ID.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="First name"
                value={editForm.firstName}
                onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
              />
              <Input
                placeholder="Last name"
                value={editForm.lastName}
                onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
              />
              <Input
                className="sm:col-span-2"
                placeholder="Login email"
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              />
              <Input
                placeholder="Phone"
                value={editForm.phone}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
              />
              <select
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
                value={editForm.roleCode}
                onChange={(e) => setEditForm({ ...editForm, roleCode: e.target.value })}
              >
                {WORKER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              <div className="sm:col-span-2 flex gap-2">
                <Button loading={update.isPending} onClick={() => update.mutate()}>
                  Save changes
                </Button>
                <Button variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Access / permissions modal */}
      {accessUser && (
        <div className="modal-overlay" onClick={() => setAccessUser(null)}>
          <Card
            className="modal-sheet relative z-10 m-0 sm:m-auto w-full max-w-lg max-h-[min(90dvh,40rem)] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader className="shrink-0 pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Lock className="h-4 w-4 text-primary" />
                    Staff access
                  </CardTitle>
                  <CardDescription className="break-safe">
                    Choose what <strong>{accessUser.firstName} {accessUser.lastName}</strong> can use.
                    Role: {accessUser.roles?.map((r) => r.name).join(', ') || '—'}
                    {accessData?.customized ? (
                      <span className="text-warning"> · Customized</span>
                    ) : null}
                  </CardDescription>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setAccessUser(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 overflow-y-auto space-y-4 pb-4">
              {loadingAccess && (
                <p className="text-sm text-muted-foreground py-6 text-center">Loading permissions…</p>
              )}
              {!loadingAccess && permsByModule.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No permissions defined yet. Seed the database or contact support.
                </p>
              )}
              {permsByModule.map(({ module, items }) => {
                const codes = items.map((i) => i.code);
                const allOn = codes.every((c) => selectedPerms.has(c));
                return (
                  <div key={module} className="rounded-xl border border-border overflow-hidden">
                    <div className="flex items-center justify-between gap-2 bg-muted/50 px-3 py-2">
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        {module.replace(/_/g, ' ')}
                      </p>
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-primary hover:underline"
                        onClick={() => selectAllInModule(codes, !allOn)}
                      >
                        {allOn ? 'Clear module' : 'Select all'}
                      </button>
                    </div>
                    <ul className="divide-y divide-border">
                      {items.map((p) => {
                        const on = selectedPerms.has(p.code);
                        const fromRole = accessData?.rolePermissions?.includes(p.code);
                        return (
                          <li key={p.code}>
                            <button
                              type="button"
                              onClick={() => togglePerm(p.code)}
                              className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors min-h-[2.75rem]"
                            >
                              {on ? (
                                <CheckSquare className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                              ) : (
                                <Square className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium leading-snug">
                                  {FEATURE_LABELS[p.code] || p.name}
                                </span>
                                <span className="block text-[10px] text-muted-foreground font-mono mt-0.5">
                                  {p.code}
                                  {fromRole ? ' · role default' : ''}
                                </span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </CardContent>
            <div className="shrink-0 border-t border-border p-3 flex flex-wrap gap-2 bg-card">
              <Button
                loading={saveAccess.isPending}
                onClick={() => saveAccess.mutate()}
                disabled={loadingAccess}
              >
                <Shield className="h-4 w-4" /> Save access
              </Button>
              <Button
                variant="outline"
                loading={resetAccess.isPending}
                onClick={() => {
                  if (window.confirm('Reset this staff member to default access for their role?')) {
                    resetAccess.mutate();
                  }
                }}
              >
                <RefreshCw className="h-4 w-4" /> Role defaults
              </Button>
              <Button variant="ghost" onClick={() => setAccessUser(null)}>
                Cancel
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Password modal */}
      {passwordUser && (
        <div className="modal-overlay" onClick={() => setPasswordUser(null)}>
          <Card className="modal-sheet relative z-10 m-0 sm:m-auto" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle className="text-base">Set password</CardTitle>
              <CardDescription>
                For {passwordUser.firstName} ({passwordUser.email}). They must use this new password next login.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="New password (min 8 chars)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  loading={genPassword.isPending}
                  onClick={() => genPassword.mutate()}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              {newPassword && (
                <Button size="sm" variant="outline" onClick={() => copyText(newPassword)}>
                  <Copy className="h-3.5 w-3.5" /> Copy password
                </Button>
              )}
              <div className="flex gap-2">
                <Button loading={setPassword.isPending} onClick={() => setPassword.mutate()}>
                  <KeyRound className="h-4 w-4" /> Update password
                </Button>
                <Button variant="ghost" onClick={() => setPasswordUser(null)}>
                  Close
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
