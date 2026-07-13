import { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border/60 bg-card text-card-foreground shadow-soft transition-all duration-300 hover:shadow-md min-w-0 max-w-full overflow-hidden',
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col space-y-0.5 p-2.5 sm:p-4 pb-2 min-w-0', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('font-semibold leading-snug tracking-tight font-display text-sm sm:text-base', className)} {...props} />
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-[11px] sm:text-sm text-muted-foreground line-clamp-2', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-2.5 sm:p-4 pt-0 min-w-0 max-w-full', className)} {...props} />;
}
