import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, UserPlus, UserCheck } from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';

const ROLES = [
  'CASHIER',
  'STORE_MANAGER',
  'WAREHOUSE_MANAGER',
  'ACCOUNTANT',
  'SALES_PERSON',
  'PHARMACIST',
  'DOCTOR',
  'ADMINISTRATOR',
];

export function AddStaffPage() {
  const qc = useQueryClient();
  const [userForm, setUserForm] = useState({
    email: '',
    password: 'Cashier@123',
    firstName: '',
    lastName: '',
    roleCode: 'CASHIER',
  });

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/users')).data,
  });

  const createUser = useMutation({
    mutationFn: async () => api.post('/users', userForm),
    onSuccess: (res) => {
      const pending = res.data?.data?.pendingApproval;
      toast.success(
        pending
          ? 'Staff added — pending approval (see list below or Staff & Approvals)'
          : 'User created'
      );
      setUserForm({
        email: '',
        password: 'Cashier@123',
        firstName: '',
        lastName: '',
        roleCode: 'CASHIER',
      });
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['staff-pending'] });
      void qc.invalidateQueries({ queryKey: ['staff-pending-count'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const confirmStaff = useMutation({
    mutationFn: async (id: string) => api.post(`/users/${id}/approve`),
    onSuccess: () => {
      toast.success('Staff confirmed — they can login now');
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['staff-pending'] });
      void qc.invalidateQueries({ queryKey: ['staff-pending-count'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="page-container fit-x pb-6 space-y-4">
      <div className="flex items-center gap-2">
        <Link
          to="/app/settings"
          aria-label="Back to Settings"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold truncate">Add staff</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Create team accounts · approve pending staff
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            New staff member
          </CardTitle>
          <CardDescription>
            New staff start as <strong>Pending approval</strong>. Confirm them below or under{' '}
            <Link to="/app/staff" className="text-primary underline">
              Staff & Approvals
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Email</label>
            <Input
              placeholder="staff@business.com"
              type="email"
              value={userForm.email}
              onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">First name</label>
              <Input
                placeholder="First name"
                value={userForm.firstName}
                onChange={(e) => setUserForm({ ...userForm, firstName: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Last name</label>
              <Input
                placeholder="Last name"
                value={userForm.lastName}
                onChange={(e) => setUserForm({ ...userForm, lastName: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Password</label>
            <Input
              placeholder="Password"
              type="password"
              value={userForm.password}
              onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Role</label>
            <select
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
              value={userForm.roleCode}
              onChange={(e) => setUserForm({ ...userForm, roleCode: e.target.value })}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <Button className="w-full h-11" loading={createUser.isPending} onClick={() => createUser.mutate()}>
            <UserPlus className="h-4 w-4" /> Create staff
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team members</CardTitle>
          <CardDescription>Confirm pending staff so they can log in</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 max-h-[28rem] overflow-y-auto">
          {(users?.data || []).map(
            (u: {
              id: string;
              email: string;
              firstName: string;
              lastName: string;
              status: string;
              roles: Array<{ name: string }>;
            }) => (
              <div
                key={u.id}
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm border-b border-border/40 pb-3 ${
                  u.status === 'PENDING_VERIFICATION' ? 'bg-warning/5 -mx-1 px-2 rounded-lg pt-2' : ''
                }`}
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {u.firstName} {u.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground break-all">{u.email}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{u.roles?.[0]?.name}</p>
                </div>
                <div className="flex flex-col sm:items-end gap-2 shrink-0">
                  <Badge
                    variant={
                      u.status === 'ACTIVE'
                        ? 'success'
                        : u.status === 'PENDING_VERIFICATION'
                          ? 'warning'
                          : 'secondary'
                    }
                  >
                    {u.status === 'PENDING_VERIFICATION' ? 'PENDING APPROVAL' : u.status}
                  </Badge>
                  {u.status === 'PENDING_VERIFICATION' && (
                    <Button
                      size="sm"
                      variant="success"
                      className="font-semibold"
                      loading={confirmStaff.isPending}
                      onClick={() => confirmStaff.mutate(u.id)}
                    >
                      <UserCheck className="h-4 w-4" /> Confirm Staff
                    </Button>
                  )}
                </div>
              </div>
            )
          )}
          {!users?.data?.length && (
            <p className="text-sm text-muted-foreground py-6 text-center">No team members yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
