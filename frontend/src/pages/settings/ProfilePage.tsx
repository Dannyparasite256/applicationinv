import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Building2, Camera, ImagePlus } from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import { getMediaUrl, brandInitials } from '@/lib/media';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';

export function ProfilePage() {
  const qc = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  const authUser = useAuthStore((s) => s.user);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    currency: 'USD',
  });
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['company'],
    queryFn: async () => (await api.get('/company')).data.data,
  });

  const { data: currencyData } = useQuery({
    queryKey: ['currencies'],
    queryFn: async () =>
      (await api.get('/currencies')).data.data as {
        catalog: Array<{ code: string; name: string }>;
      },
  });

  useEffect(() => {
    if (data) {
      setProfile({
        name: data.name || '',
        phone: data.phone || '',
        email: data.email || '',
        address: data.address || '',
        currency: data.currency || 'USD',
      });
      setLogoPreview(getMediaUrl(data.logoUrl));
    }
  }, [data]);

  const saveCompany = useMutation({
    mutationFn: async () => api.put('/company', profile),
    onSuccess: (res) => {
      toast.success('Company profile saved');
      qc.invalidateQueries({ queryKey: ['company'] });
      qc.invalidateQueries({ queryKey: ['currencies'] });
      const c = res.data?.data;
      if (authUser && c) {
        setUser({
          ...authUser,
          company: {
            id: c.id,
            name: c.name,
            slug: c.slug,
            logoUrl: c.logoUrl,
            currency: c.currency,
          },
        });
      }
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('logo', file);
      return api.post('/company/logo', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: (res) => {
      const c = res.data?.data;
      toast.success('Business logo updated');
      setLogoPreview(getMediaUrl(c?.logoUrl));
      qc.invalidateQueries({ queryKey: ['company'] });
      if (authUser && c) {
        setUser({
          ...authUser,
          company: {
            id: c.id,
            name: c.name,
            slug: c.slug,
            logoUrl: c.logoUrl,
            currency: c.currency,
          },
        });
      }
    },
    onError: (e) => toast.error(getErrorMessage(e) || 'Logo upload failed'),
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
          <h1 className="text-xl sm:text-2xl font-bold truncate">Profile</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Business logo, name, contact & base currency
          </p>
        </div>
      </div>

      <Card className="overflow-hidden border-primary/15">
        <div className="h-20 bg-brand-gradient relative">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,rgba(255,255,255,0.2),transparent_50%)]" />
        </div>
        <CardContent className="pt-0 -mt-10 relative space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <div className="relative">
              <div className="brand-mark h-20 w-20 text-xl ring-4 ring-card shadow-elevated">
                {logoPreview ? (
                  <img src={logoPreview} alt="Business logo" className="h-full w-full object-cover" />
                ) : (
                  brandInitials(profile.name || data?.name)
                )}
              </div>
              <button
                type="button"
                className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-glow"
                title="Upload business logo"
                onClick={() => logoInputRef.current?.click()}
              >
                <Camera className="h-4 w-4" />
              </button>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 8 * 1024 * 1024) {
                    toast.error('Image must be under 8 MB');
                    return;
                  }
                  setLogoPreview(URL.createObjectURL(file));
                  uploadLogo.mutate(file);
                  e.target.value = '';
                }}
              />
            </div>
            <div className="flex-1 min-w-0 pb-1">
              <h2 className="text-lg font-bold truncate">{profile.name || data?.name || 'Your business'}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Logo appears in the sidebar, top bar, and documents.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={uploadLogo.isPending}
                  onClick={() => logoInputRef.current?.click()}
                >
                  <ImagePlus className="h-4 w-4" />
                  {logoPreview ? 'Change logo' : 'Add logo'}
                </Button>
                <Badge variant="secondary" className="h-8 px-3">
                  {data?.status || '—'} · {data?.slug || 'workspace'}
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            Company details
          </CardTitle>
          <CardDescription>Legal name, contact, and accounting base currency</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Business name</label>
            <Input
              placeholder="Company name"
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Email</label>
            <Input
              placeholder="Email"
              value={profile.email}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Phone</label>
            <Input
              placeholder="Phone"
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Address</label>
            <Input
              placeholder="Address"
              value={profile.address}
              onChange={(e) => setProfile({ ...profile, address: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Base currency (accounting)
            </label>
            <select
              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              value={profile.currency}
              onChange={(e) => setProfile({ ...profile, currency: e.target.value })}
            >
              {(currencyData?.catalog || [{ code: 'USD', name: 'US Dollar' }]).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">
              For live rates & display currency, open Currency & FX rates from Settings.
            </p>
          </div>
          <Button className="w-full" loading={saveCompany.isPending} onClick={() => saveCompany.mutate()}>
            Save company profile
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
