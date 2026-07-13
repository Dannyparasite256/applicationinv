import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { register as registerApi } from '@/services/auth.service';
import { useAuthStore } from '@/stores/authStore';
import { useCurrencyStore } from '@/stores/currencyStore';
import { getErrorMessage } from '@/lib/api';
import { detectCurrencyFromDevice, detectCurrencyFromLocation } from '@/lib/localeCurrency';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';

const schema = z.object({
  companyName: z.string().min(2),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(8),
});

type FormData = z.infer<typeof schema>;

export function RegisterPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const applyLocationDefault = useCurrencyStore((s) => s.applyLocationDefault);
  const deviceGuess = detectCurrencyFromDevice();
  const [localCurrency, setLocalCurrency] = useState(deviceGuess.currency);
  const [localCountry, setLocalCountry] = useState<string | null>(deviceGuess.country);

  useEffect(() => {
    let cancelled = false;
    void detectCurrencyFromLocation().then((loc) => {
      if (cancelled) return;
      setLocalCurrency(loc.currency);
      setLocalCountry(loc.country);
      applyLocationDefault(loc.currency);
    });
    return () => {
      cancelled = true;
    };
  }, [applyLocationDefault]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormData) => {
    try {
      const result = await registerApi({
        ...values,
        currency: localCurrency,
        country: localCountry || undefined,
      });
      if (!result?.accessToken || !result?.user) {
        toast.error('Account may have been created, but login data was incomplete. Try signing in.');
        navigate('/login');
        return;
      }
      setAuth(result.user, result.accessToken, result.refreshToken);
      applyLocationDefault(localCurrency);
      toast.success(`Company created · default currency ${localCurrency}`);
      navigate('/app', { replace: true });
    } catch (e) {
      const msg = getErrorMessage(e);
      // Account often already exists if a previous attempt saved to DB but the
      // client timed out while the server was still sending email.
      if (/already registered|already exists|conflict|email.*taken/i.test(msg)) {
        toast.message('This email already has an account', {
          description: 'Sign in with your password, or use Forgot password if needed.',
        });
        navigate('/login', { replace: true });
        return;
      }
      toast.error(msg);
    }
  };

  return (
    <div className="auth-shell min-h-[100dvh] flex items-center justify-center p-4 overflow-y-auto">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-accent/10" />
      <Card className="relative w-full max-w-lg glass">
        <CardHeader>
          <CardTitle className="text-2xl">Create your company</CardTitle>
          <CardDescription>
            Start your 30-day trial of Enterprise IMS
            {localCurrency ? (
              <>
                {' '}
                · Base currency set to <strong>{localCurrency}</strong> from your location
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-sm font-medium mb-1.5 block">Company name</label>
              <Input {...register('companyName')} placeholder="Acme Retail Ltd" />
              {errors.companyName && <p className="text-xs text-destructive mt-1">{errors.companyName.message}</p>}
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">First name</label>
              <Input {...register('firstName')} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Last name</label>
              <Input {...register('lastName')} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-sm font-medium mb-1.5 block">Work email</label>
              <Input type="email" {...register('email')} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-sm font-medium mb-1.5 block">Phone (optional)</label>
              <Input {...register('phone')} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-sm font-medium mb-1.5 block">Password</label>
              <Input type="password" {...register('password')} placeholder="Min 8 chars, upper, lower, number" />
              {errors.password && <p className="text-xs text-destructive mt-1">{errors.password.message}</p>}
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" className="w-full" loading={isSubmitting}>
                Create account
              </Button>
            </div>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link to="/login" className="text-primary font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
