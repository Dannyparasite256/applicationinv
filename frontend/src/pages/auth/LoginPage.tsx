import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Sparkles } from 'lucide-react';
import { login } from '@/services/auth.service';
import { useAuthStore } from '@/stores/authStore';
import { getErrorMessage } from '@/lib/api';
import { getDefaultHome } from '@/lib/roleAccess';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { requestNotificationPermission } from '@/native/notifications';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
  twoFactorCode: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const logout = useAuthStore((s) => s.logout);
  const [needs2FA, setNeeds2FA] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: FormData) => {
    try {
      const result = await login(
        values.email,
        values.password,
        values.twoFactorCode?.trim() || undefined
      );
      if (result.requires2FA) {
        setNeeds2FA(true);
        toast.message('Enter your 2FA code');
        return;
      }
      setAuth(result.user, result.accessToken, result.refreshToken);
      void requestNotificationPermission();
      toast.success('Welcome back!');
      navigate(getDefaultHome(result.user?.roles || []));
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  return (
    <div className="min-h-[100dvh] w-full max-w-[100vw] relative flex items-center justify-center p-3 sm:p-4 overflow-x-hidden overflow-y-auto">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900" />
      <div className="absolute inset-0 bg-grid-pattern opacity-20" style={{ backgroundSize: '32px 32px' }} />
      <motion.div
        className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-blue-500/30 blur-3xl pointer-events-none"
        animate={{ x: [0, 40, 0], y: [0, 20, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl pointer-events-none"
        animate={{ x: [0, -30, 0], y: [0, -25, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        className="relative w-full max-w-md min-w-0 rounded-2xl sm:rounded-3xl border border-white/10 bg-white/95 dark:bg-slate-900/90 shadow-2xl backdrop-blur-xl p-4 sm:p-8 my-auto"
      >
        <div className="text-center mb-5 sm:mb-7">
          <motion.div
            initial={{ scale: 0.6, rotate: -12 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 16, delay: 0.05 }}
            className="mx-auto mb-3 sm:mb-4 flex h-12 w-12 sm:h-16 sm:w-16 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-400 text-white font-extrabold text-lg sm:text-xl shadow-xl shadow-indigo-600/35 ring-4 ring-white/20"
          >
            EI
          </motion.div>
          <h1 className="text-xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Welcome back
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1.5 flex items-center justify-center gap-1.5 flex-wrap">
            <Sparkles className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
            Modern ERP · POS · Inventory
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block text-slate-700 dark:text-slate-200">
              Email
            </label>
            <Input type="email" autoComplete="username" placeholder="you@company.com" {...register('email')} />
            {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email.message}</p>}
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block text-slate-700 dark:text-slate-200">
              Password
            </label>
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              {...register('password')}
            />
            {errors.password && <p className="text-xs text-red-600 mt-1">{errors.password.message}</p>}
          </div>
          {needs2FA && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
              <label className="text-sm font-medium mb-1.5 block">2FA Code</label>
              <Input placeholder="000000" maxLength={6} {...register('twoFactorCode')} />
            </motion.div>
          )}
          <div className="flex justify-end">
            <Link to="/forgot-password" className="text-sm text-blue-600 hover:underline">
              Forgot password?
            </Link>
          </div>
          <Button type="submit" className="w-full h-11 text-base shadow-lg shadow-blue-600/20" loading={isSubmitting}>
            Sign in
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          New company?{' '}
          <Link to="/register" className="text-blue-600 font-medium hover:underline">
            Create account
          </Link>
        </p>

        <button
          type="button"
          className="mt-4 w-full text-xs text-slate-400 hover:text-slate-600 underline"
          onClick={() => {
            logout();
            localStorage.removeItem('eims-auth');
            toast.message('Session cleared');
            window.location.href = '/login';
          }}
        >
          Page blank or stuck? Clear session
        </button>
      </motion.div>
    </div>
  );
}
