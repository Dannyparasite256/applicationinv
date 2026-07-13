import type { MouseEvent } from 'react';
import { Phone, MessageSquare, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  callPhone,
  hasPhoneNumber,
  messagePhone,
  normalizePhoneForDial,
  whatsAppPhone,
} from '@/lib/phoneActions';
import { cn } from '@/lib/utils';

type Props = {
  phone?: string | null;
  /** Optional SMS / WhatsApp prefill */
  messageBody?: string;
  /** Show the number text next to icons (default true) */
  showNumber?: boolean;
  /** Compact icon-only row */
  className?: string;
  /** Include WhatsApp shortcut (default true on mobile-friendly UIs) */
  showWhatsApp?: boolean;
};

/**
 * Phone number with tap-to-call and tap-to-message actions for staff / owners.
 */
export function PhoneActions({
  phone,
  messageBody,
  showNumber = true,
  className,
  showWhatsApp = true,
}: Props) {
  const ok = hasPhoneNumber(phone);
  const display = phone?.trim() || '—';

  if (!ok) {
    return <span className={cn('text-muted-foreground', className)}>{display}</span>;
  }

  const onCall = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      callPhone(phone);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open dialer');
    }
  };

  const onSms = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      messagePhone(phone, messageBody);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open messages');
    }
  };

  const onWa = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      whatsAppPhone(phone, messageBody);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open WhatsApp');
    }
  };

  const btn =
    'inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-foreground shadow-sm hover:bg-muted active:scale-95 transition-all shrink-0';

  return (
    <div className={cn('inline-flex items-center gap-1.5 min-w-0 max-w-full', className)}>
      {showNumber && (
        <a
          href={`tel:${normalizePhoneForDial(phone)}`}
          onClick={onCall}
          className="tabular-nums text-primary hover:underline truncate min-w-0 text-xs sm:text-sm"
          title={`Call ${display}`}
        >
          {display}
        </a>
      )}
      <button type="button" className={cn(btn, 'text-success')} onClick={onCall} title={`Call ${display}`} aria-label={`Call ${display}`}>
        <Phone className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={cn(btn, 'text-primary')} onClick={onSms} title={`Message ${display}`} aria-label={`SMS ${display}`}>
        <MessageSquare className="h-3.5 w-3.5" />
      </button>
      {showWhatsApp && (
        <button
          type="button"
          className={cn(btn, 'text-emerald-600 dark:text-emerald-400')}
          onClick={onWa}
          title={`WhatsApp ${display}`}
          aria-label={`WhatsApp ${display}`}
        >
          <MessageCircle className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
