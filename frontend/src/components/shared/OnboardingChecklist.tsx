import { Link } from 'react-router-dom';
import { Check, Circle, X, Rocket } from 'lucide-react';
import { usePreferencesStore, type OnboardingStepId } from '@/stores/preferencesStore';
import { useAuthStore } from '@/stores/authStore';
import { isManager } from '@/lib/roleAccess';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

const STEPS: Array<{ id: OnboardingStepId; title: string; hint: string; to: string }> = [
  { id: 'logo', title: 'Add business logo', hint: 'Shows on receipts & app', to: '/app/settings/profile' },
  { id: 'currency', title: 'Set currency', hint: 'Base + display rates', to: '/app/settings/currency' },
  { id: 'product', title: 'Add first product', hint: 'Stock & prices', to: '/app/products' },
  { id: 'sale', title: 'Make a test sale', hint: 'Open POS and charge', to: '/app/pos' },
  { id: 'staff', title: 'Invite staff', hint: 'Cashiers & managers', to: '/app/settings/staff' },
];

export function OnboardingChecklist() {
  const roles = useAuthStore((s) => s.user?.roles || []);
  const dismissed = usePreferencesStore((s) => s.onboardingDismissed);
  const completed = usePreferencesStore((s) => s.onboardingCompleted);
  const dismiss = usePreferencesStore((s) => s.dismissOnboarding);

  if (!isManager(roles) || dismissed) return null;

  const doneCount = STEPS.filter((s) => completed.includes(s.id)).length;
  if (doneCount >= STEPS.length) return null;

  const pct = Math.round((doneCount / STEPS.length) * 100);

  return (
    <Card className="border-primary/25 bg-primary/5 overflow-hidden">
      <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" />
            Get set up
          </CardTitle>
          <CardDescription>
            {doneCount} of {STEPS.length} done · {pct}% ready
          </CardDescription>
        </div>
        <Button size="sm" variant="ghost" className="shrink-0 h-8 px-2" onClick={dismiss} aria-label="Dismiss">
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <ul className="space-y-1.5">
          {STEPS.map((s) => {
            const done = completed.includes(s.id);
            return (
              <li key={s.id}>
                <Link
                  to={s.to}
                  className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card/80 px-3 py-2.5 hover:border-primary/40 transition-colors"
                >
                  {done ? (
                    <Check className="h-4 w-4 text-success shrink-0" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium truncate ${done ? 'line-through text-muted-foreground' : ''}`}>
                      {s.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">{s.hint}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
