import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { KeyRound, Mail, ShieldCheck, ArrowLeft, RefreshCw } from 'lucide-react';
import { forgotPassword, resetPassword } from '@/services/auth.service';
import { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

const emailSchema = z.object({
  email: z.string().email('Enter a valid email'),
});

const resetSchema = z
  .object({
    code: z
      .string()
      .min(6, 'Enter the 6-digit code')
      .max(6)
      .regex(/^\d{6}$/, 'Code must be 6 digits'),
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

type EmailForm = z.infer<typeof emailSchema>;
type ResetForm = z.infer<typeof resetSchema>;

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<'email' | 'preview' | null>(null);
  const [resending, setResending] = useState(false);

  const emailForm = useForm<EmailForm>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: '' },
  });

  const resetForm = useForm<ResetForm>({
    resolver: zodResolver(resetSchema),
    defaultValues: { code: '', password: '', confirm: '' },
  });

  const sendCode = async (values: EmailForm) => {
    const result = await forgotPassword(values.email.trim());
    const data = (
      result as {
        data?: {
          previewUrl?: string;
          message?: string;
          delivery?: 'email' | 'preview';
        };
      }
    )?.data;
    setEmail(values.email.trim().toLowerCase());
    setPreviewUrl(data?.previewUrl || null);
    setDelivery(data?.delivery || (data?.previewUrl ? 'preview' : 'email'));
    setStep('code');
    resetForm.reset({ code: '', password: '', confirm: '' });
    toast.success(data?.message || 'Reset code sent — check your email');
    if (data?.previewUrl) {
      toast.message('Open the email preview to copy your 6-digit code', {
        description: 'No real SMTP configured yet — use the preview link',
        duration: 10_000,
        action: {
          label: 'Open email',
          onClick: () => window.open(data.previewUrl!, '_blank'),
        },
      });
    }
  };

  const onRequestCode = async (values: EmailForm) => {
    try {
      await sendCode(values);
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const onResend = async () => {
    if (!email) return;
    setResending(true);
    try {
      await sendCode({ email });
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setResending(false);
    }
  };

  const onReset = async (values: ResetForm) => {
    try {
      await resetPassword({
        email,
        code: values.code.trim(),
        password: values.password,
      });
      toast.success('Password updated — you can sign in now');
      navigate('/login', { replace: true });
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  return (
    <div className="auth-shell min-h-[100dvh] w-full max-w-[100vw] relative flex items-center justify-center p-3 sm:p-4 overflow-x-hidden overflow-y-auto">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900" />
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.12) 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md min-w-0 rounded-2xl sm:rounded-3xl border border-white/10 bg-white/95 dark:bg-slate-900/90 shadow-2xl backdrop-blur-xl p-4 sm:p-7 my-auto"
      >
        <div className="text-center mb-5">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-cyan-500 text-white shadow-lg shadow-indigo-600/30">
            <KeyRound className="h-6 w-6" />
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            {step === 'email' ? 'Forgot password?' : 'Enter reset code'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1.5">
            {step === 'email'
              ? 'We email you a 6-digit code. Enter it here to set a new password.'
              : delivery === 'preview'
                ? `Code ready for ${email}. Open the email preview below to copy it.`
                : `Code sent to ${email}. Check inbox and spam.`}
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-5">
          <div
            className={`flex-1 h-1.5 rounded-full ${step === 'email' || step === 'code' ? 'bg-primary' : 'bg-muted'}`}
          />
          <div className={`flex-1 h-1.5 rounded-full ${step === 'code' ? 'bg-primary' : 'bg-muted'}`} />
        </div>

        <AnimatePresence mode="wait">
          {step === 'email' ? (
            <motion.form
              key="email"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              onSubmit={emailForm.handleSubmit(onRequestCode)}
              className="space-y-4"
            >
              <div>
                <label className="text-sm font-medium mb-1.5 flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                  <Mail className="h-3.5 w-3.5" /> Work email
                </label>
                <Input
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="you@company.com"
                  {...emailForm.register('email')}
                />
                {emailForm.formState.errors.email && (
                  <p className="text-xs text-red-600 mt-1">{emailForm.formState.errors.email.message}</p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full h-11"
                loading={emailForm.formState.isSubmitting}
              >
                Send reset code
              </Button>
            </motion.form>
          ) : (
            <motion.form
              key="code"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              onSubmit={resetForm.handleSubmit(onReset)}
              className="space-y-3.5"
            >
              <div>
                <label className="text-sm font-medium mb-1.5 flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                  <ShieldCheck className="h-3.5 w-3.5" /> 6-digit code
                </label>
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                  placeholder="000000"
                  className="text-center text-xl tracking-[0.35em] font-mono font-bold h-12"
                  {...resetForm.register('code')}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                    resetForm.setValue('code', v, { shouldValidate: true });
                  }}
                />
                {resetForm.formState.errors.code && (
                  <p className="text-xs text-red-600 mt-1">{resetForm.formState.errors.code.message}</p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block text-slate-700 dark:text-slate-200">
                  New password
                </label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Min 8 chars, upper, lower, number"
                  {...resetForm.register('password')}
                />
                {resetForm.formState.errors.password && (
                  <p className="text-xs text-red-600 mt-1">{resetForm.formState.errors.password.message}</p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block text-slate-700 dark:text-slate-200">
                  Confirm password
                </label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Repeat new password"
                  {...resetForm.register('confirm')}
                />
                {resetForm.formState.errors.confirm && (
                  <p className="text-xs text-red-600 mt-1">{resetForm.formState.errors.confirm.message}</p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full h-11"
                loading={resetForm.formState.isSubmitting}
              >
                Set new password
              </Button>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  className="text-sm text-slate-500 hover:text-primary inline-flex items-center gap-1"
                  onClick={() => {
                    setStep('email');
                    setPreviewUrl(null);
                  }}
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Change email
                </button>
                <button
                  type="button"
                  className="text-sm text-primary hover:underline inline-flex items-center gap-1 disabled:opacity-50"
                  disabled={resending}
                  onClick={() => void onResend()}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${resending ? 'animate-spin' : ''}`} />
                  Resend code
                </button>
              </div>

              {previewUrl && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 dark:bg-indigo-950/40 dark:border-indigo-800 p-3 space-y-2">
                  <p className="text-xs text-indigo-900 dark:text-indigo-100 font-medium">
                    Your 6-digit code is inside this email message. Open it, copy the code, paste it above.
                  </p>
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-2 w-full h-10 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500"
                  >
                    <Mail className="h-4 w-4" /> Open email with code
                  </a>
                </div>
              )}
              {delivery === 'email' && !previewUrl && (
                <p className="text-[11px] text-center text-slate-500">
                  Didn’t get it? Check spam, wait a minute, then use Resend code.
                </p>
              )}
            </motion.form>
          )}
        </AnimatePresence>

        <p className="mt-5 text-center text-sm text-slate-500">
          <Link to="/login" className="text-primary font-medium hover:underline">
            Back to sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
