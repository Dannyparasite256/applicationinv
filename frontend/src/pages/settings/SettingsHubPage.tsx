import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Building2,
  ChevronRight,
  Coins,
  Package,
  RefreshCw,
  Type,
  UserPlus,
  Users,
  Volume2,
  Vibrate,
  Palette,
  Type as TypeIcon,
} from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { APP_FONTS } from '@/lib/fonts';
import { useThemeStore } from '@/stores/themeStore';
import { usePreferencesStore, type ThemePreset } from '@/stores/preferencesStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';

function SettingsLink({
  to,
  icon: Icon,
  title,
  subtitle,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-3.5 hover:bg-muted/40 transition-colors min-h-[3.25rem]"
    >
      <div className="min-w-0 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
        </div>
      </div>
      <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
    </Link>
  );
}

/**
 * Settings hub — opens separate screens for Profile, Fonts, Currency, Add staff.
 */
export function SettingsHubPage() {
  const qc = useQueryClient();
  const fontId = useThemeStore((s) => s.fontId);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const soundsEnabled = usePreferencesStore((s) => s.soundsEnabled);
  const hapticsEnabled = usePreferencesStore((s) => s.hapticsEnabled);
  const themePreset = usePreferencesStore((s) => s.themePreset);
  const labelMode = usePreferencesStore((s) => s.labelMode);
  const setSoundsEnabled = usePreferencesStore((s) => s.setSoundsEnabled);
  const setHapticsEnabled = usePreferencesStore((s) => s.setHapticsEnabled);
  const setThemePreset = usePreferencesStore((s) => s.setThemePreset);
  const setLabelMode = usePreferencesStore((s) => s.setLabelMode);
  const currentFontLabel = APP_FONTS.find((f) => f.id === fontId)?.label || 'Phone system font';
  const [branchForm, setBranchForm] = useState({ code: '', name: '' });

  const { data } = useQuery({
    queryKey: ['company'],
    queryFn: async () => (await api.get('/company')).data.data,
  });

  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get('/notifications')).data.data,
  });

  const { data: currencyData } = useQuery({
    queryKey: ['currencies'],
    queryFn: async () =>
      (await api.get('/currencies')).data.data as { baseCurrency?: string },
  });

  const createBranch = useMutation({
    mutationFn: async () => api.post('/branches', branchForm),
    onSuccess: () => {
      toast.success('Branch created');
      qc.invalidateQueries({ queryKey: ['company'] });
      qc.invalidateQueries({ queryKey: ['branches'] });
      setBranchForm({ code: '', name: '' });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="page-container fit-x pb-6 space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Settings</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Open a section below — each has its own full screen
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Palette className="h-4 w-4 text-primary" /> Experience
          </CardTitle>
          <CardDescription>Sounds, haptics, look & cashier labels</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={soundsEnabled ? 'default' : 'outline'}
              onClick={() => setSoundsEnabled(!soundsEnabled)}
            >
              <Volume2 className="h-4 w-4" /> Sounds {soundsEnabled ? 'on' : 'off'}
            </Button>
            <Button
              size="sm"
              variant={hapticsEnabled ? 'default' : 'outline'}
              onClick={() => setHapticsEnabled(!hapticsEnabled)}
            >
              <Vibrate className="h-4 w-4" /> Haptics {hapticsEnabled ? 'on' : 'off'}
            </Button>
            <Button
              size="sm"
              variant={labelMode === 'simple' ? 'default' : 'outline'}
              onClick={() => setLabelMode(labelMode === 'simple' ? 'normal' : 'simple')}
            >
              <TypeIcon className="h-4 w-4" />{' '}
              {labelMode === 'simple' ? 'Simple labels' : 'Normal labels'}
            </Button>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Theme preset</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: 'clean', label: 'Clean' },
                  { id: 'night', label: 'Night shift' },
                  { id: 'contrast', label: 'High contrast' },
                ] as Array<{ id: ThemePreset; label: string }>
              ).map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant={themePreset === p.id ? 'default' : 'outline'}
                  onClick={() => {
                    setThemePreset(p.id);
                    if (p.id === 'night') setTheme('dark');
                  }}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={theme === 'light' ? 'default' : 'outline'}
              onClick={() => setTheme('light')}
            >
              Light
            </Button>
            <Button
              size="sm"
              variant={theme === 'dark' ? 'default' : 'outline'}
              onClick={() => setTheme('dark')}
            >
              Dark
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Business</CardTitle>
          <CardDescription>Profile, money, and team</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <SettingsLink
            to="/app/settings/profile"
            icon={Building2}
            title="Profile"
            subtitle={`${data?.name || 'Company'} · logo & contact`}
          />
          <SettingsLink
            to="/app/settings/currency"
            icon={Coins}
            title="Currency & live FX rates"
            subtitle={`Base ${currencyData?.baseCurrency || data?.currency || 'USD'} · refresh rates`}
          />
          <SettingsLink
            to="/app/settings/staff"
            icon={UserPlus}
            title="Add staff"
            subtitle="Create accounts · confirm pending staff"
          />
          <Link
            to="/app/staff"
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-3.5 hover:bg-muted/40 transition-colors min-h-[3.25rem]"
          >
            <div className="min-w-0 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <Users className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Staff & approvals</p>
                <p className="text-xs text-muted-foreground truncate">Permissions and pending logins</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Appearance</CardTitle>
          <CardDescription>Theme and fonts</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium mb-2">Theme</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={theme === 'light' ? 'default' : 'outline'}
                onClick={() => setTheme('light')}
              >
                Light
              </Button>
              <Button
                size="sm"
                variant={theme === 'dark' ? 'default' : 'outline'}
                onClick={() => setTheme('dark')}
              >
                Dark
              </Button>
            </div>
          </div>
          <SettingsLink
            to="/app/settings/fonts"
            icon={Type}
            title="Fonts"
            subtitle={`Current: ${currentFontLabel} · tap to choose`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Branches</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(data?.branches || []).map(
            (b: { id: string; name: string; code: string; isHeadOffice: boolean }) => (
              <div key={b.id} className="flex justify-between text-sm">
                <span>
                  {b.name} <span className="text-muted-foreground">({b.code})</span>
                </span>
                {b.isHeadOffice && <Badge>HQ</Badge>}
              </div>
            )
          )}
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <Input
              placeholder="Code"
              value={branchForm.code}
              onChange={(e) => setBranchForm({ ...branchForm, code: e.target.value })}
            />
            <Input
              placeholder="Name"
              value={branchForm.name}
              onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
            />
            <Button
              size="sm"
              className="shrink-0"
              loading={createBranch.isPending}
              onClick={() => createBranch.mutate()}
            >
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Notifications <RefreshCw className="h-3.5 w-3.5" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 max-h-64 overflow-y-auto">
          {(notifications || []).map(
            (n: { id: string; title: string; body: string; createdAt: string; status: string }) => (
              <div key={n.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium">{n.title}</p>
                <p className="text-muted-foreground">{n.body}</p>
                <p className="text-xs text-muted-foreground mt-1">{formatDate(n.createdAt)}</p>
              </div>
            )
          )}
          {!notifications?.length && (
            <p className="text-sm text-muted-foreground flex items-center gap-2 py-4 justify-center">
              <Package className="h-4 w-4" /> No notifications yet
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
