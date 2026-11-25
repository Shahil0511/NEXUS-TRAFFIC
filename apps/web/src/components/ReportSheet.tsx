import type { LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { Panel } from '@/components/Panel';

/** One titled block of the sheet. */
export interface ReportSection {
  title: string;
  description?: ReactNode;
  /** Decorative section icon before the title (the title names the region). */
  icon?: LucideIcon;
  content: ReactNode;
}

export interface ReportSheetProps {
  /** The facts strip under the headline (components/FactSheet, layout 'strip'). */
  headlineFacts?: ReactNode;
  /** The one wide chart; `aside` = its legend or switch. */
  chart: ReportSection & { aside?: ReactNode };
  /** Left column: what happens around the object (neighbour pages, actions, status codes). */
  around: ReportSection;
  /** Right column: components/WhoUsesIt (already a panel). */
  who: ReactNode;
  /** The one wide second row ("Used with", later "Speed and failures"). */
  second: ReportSection;
  /** Anything that follows the sheet (a table of single requests). */
  after?: ReactNode;
}

/**
 * WHY: one page, one feature and one request type are read like a short report — facts, one wide
 * chart, "around it" next to "who", one wide second row — so they share this layout and no longer
 * look like a dashboard of cards. Layout ONLY: each view passes its own content. The two columns
 * stack below lg (min-w-0 so a long path never widens the page on a phone).
 */
export function ReportSheet({
  headlineFacts,
  chart,
  around,
  who,
  second,
  after,
}: ReportSheetProps) {
  return (
    <div className="space-y-4" data-slot="report-sheet">
      {headlineFacts ? (
        <div
          data-slot="report-facts"
          className="min-w-0 rounded-xl border border-dashed border-border bg-card/60 px-4 py-3"
        >
          {headlineFacts}
        </div>
      ) : null}
      <Panel
        title={chart.title}
        icon={chart.icon}
        description={chart.description}
        aside={chart.aside}
        className="min-w-0"
      >
        {chart.content}
      </Panel>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2" data-slot="report-columns">
        <Panel
          title={around.title}
          icon={around.icon}
          description={around.description}
          className="min-w-0"
        >
          {around.content}
        </Panel>
        <div className="grid min-w-0">{who}</div>
      </div>
      <Panel
        title={second.title}
        icon={second.icon}
        description={second.description}
        className="min-w-0"
      >
        {second.content}
      </Panel>
      {after}
    </div>
  );
}

/**
 * WHY: a report panel often holds two lists ("Came from" | "Went to"); each gets its own h3 under
 * the panel's h2 and names its own region, so moving by heading or landmark reaches every list.
 */
export function ReportSubsection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const headingId = `report-sub-${useId()}`;
  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-3">
      <div>
        <h3 id={headingId} className="font-heading text-sm font-semibold">
          {title}
        </h3>
        {description ? <p className="text-2xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
