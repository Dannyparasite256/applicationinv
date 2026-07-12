import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

type Action = { label: string; onClick: () => void; variant?: 'default' | 'outline' | 'secondary' };

export function SuccessBurst({
  open,
  title,
  subtitle,
  actions,
  onClose,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  actions?: Action[];
  onClose?: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8 }}
          className="rounded-2xl border border-success/30 bg-success/10 p-4 space-y-3"
        >
          <div className="flex items-start gap-3">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 16 }}
              className="text-success shrink-0"
            >
              <CheckCircle2 className="h-8 w-8" />
            </motion.div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-sm sm:text-base">{title}</p>
              {subtitle && (
                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">{subtitle}</p>
              )}
            </div>
            {onClose && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:underline"
                onClick={onClose}
              >
                Dismiss
              </button>
            )}
          </div>
          {actions && actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {actions.map((a) => (
                <Button key={a.label} size="sm" variant={a.variant || 'default'} onClick={a.onClick}>
                  {a.label}
                </Button>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
