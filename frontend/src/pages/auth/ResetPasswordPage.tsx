import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { KeyRound } from 'lucide-react';
import { resetPassword } from '@/services/auth.service';
import { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

const schema = z
  .object({
    password: z
      .string()
      .min(8, 'At least 8 characters')
      .regex(/[A-Z]/, 'Need an uppercase letter')
      .regex(/[a-z]/, 'Need a lowercase letter')
      .regex(/[0-9]/, 'Need a number'),
    confirm: z.string().min(1, 'Confirm your password'),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

type FormData = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = useMemo(() => params.get('token')?.trim() || '', [params]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = async (values: FormData) => {
    if (!token) {
      toast.error('Missing reset token. Use the link from your email or request a new code.');
      return;
    }
    try {
      await resetPassword({ token, password: values.password });
      toast.success('Password updated — you can sign in now');
      navigate('/login', { replace: true });
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  return (
    <div className="auth-shell min-h-[100dvh] w-full max-w-[100vw] relative flex items-center justify-center p-3 sm:p-4 overflow-x-hidden overflow-y-auto">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md min-w-0 rounded-2xl sm:rounded-3xl border border-white/10 bg-white/95 dark:bg-slate-900/90 shadow-2xl backdrop-blur-xl p-4 sm:p-7 my-auto"
      >
        <div className="text-center mb-5">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-cyan-500 text-white shadow-lg">
            <KeyRound className="h-6 w-6" />
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
            Set new password
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1.5">
            Choose a strong password for your account
          </p>
        </div>

        {!token ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              This link is missing a reset token. Request a new code from Forgot password, or open the
              full link from your email.
            </p>
            <Button className="w-full" onClick={() => navigate('/forgot-password')}>
              Request reset code
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3.5">
            <div>
              <label className="text-sm font-medium mb-1.5 block">New password</label>
              <Input
                type="password"
                autoComplete="new-password"
                placeholder="Min 8 chars, upper, lower, number"
                {...register('password')}
              />
              {errors.password && (
                <p className="text-xs text-red-600 mt-1">{errors.password.message}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Confirm password</label>
              <Input
                type="password"
                autoComplete="new-password"
                placeholder="Repeat new password"
                {...register('confirm')}
              />
              {errors.confirm && (
                <p className="text-xs text-red-600 mt-1">{errors.confirm.message}</p>
              )}
            </div>
            <Button type="submit" className="w-full h-11" loading={isSubmitting}>
              Update password
            </Button>
          </form>
        )}

        <p className="mt-5 text-center text-sm text-slate-500">
          <Link to="/login" className="text-primary font-medium hover:underline">
            Back to sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
