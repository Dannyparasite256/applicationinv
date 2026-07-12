import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

type Action = {
  label: string;
  onClick?: () => void;
  href?: string;
  variant?: 'default' | 'outline' | 'secondary';
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondary,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: Action;
  secondary?: Action;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center py-10 px-4 gap-2',
        className
      )}
    >
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-1">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <p className="text-sm font-semibold">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">{description}</p>
      )}
      {(action || secondary) && (
        <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
          {action && <ActionButton a={action} />}
          {secondary && <ActionButton a={{ ...secondary, variant: secondary.variant || 'outline' }} />}
        </div>
      )}
    </div>
  );
}

function ActionButton({ a }: { a: Action }) {
  if (a.href) {
    return (
      <a
        href={a.href}
        className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
      >
        {a.label}
      </a>
    );
  }
  return (
    <Button size="sm" variant={a.variant || 'default'} onClick={a.onClick}>
      {a.label}
    </Button>
  );
}
