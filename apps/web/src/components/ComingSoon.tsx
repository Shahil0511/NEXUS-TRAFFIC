import { Sparkles, type LucideIcon } from 'lucide-react';

import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import type { DeliveryStep } from '@/lib/nav';

export interface ComingSoonProps {
  title: string;
  step: DeliveryStep;
  /** What the page will show, one line each. */
  highlights: readonly string[];
  icon?: LucideIcon;
}

/**
 * WHY: pages whose data source arrives in a later step (browser ingest S3, live S4, admin S5)
 * are already in the navigation; they explain what is coming instead of showing an empty grid.
 */
export function ComingSoon({ title, step, highlights, icon: Icon = Sparkles }: ComingSoonProps) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} />
      <Card className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative flex flex-col items-start gap-4 p-8 sm:flex-row sm:items-center">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <Icon className="size-6" aria-hidden="true" />
          </span>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">Coming in {step}</h2>
              <Badge variant="outline">{step}</Badge>
            </div>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {highlights.map((line) => (
                <li key={line} className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-2 size-1 shrink-0 rounded-full bg-primary"
                  />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
