import type { IntegrationLevel } from '@nexus/shared';
import { BadgeCheck, CircleDashed, Link2, type LucideIcon, Unplug } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

import { LEVEL_COPY } from './integrationCopy';

const LEVEL_ICONS: Record<IntegrationLevel, LucideIcon> = {
  not_connected: Unplug,
  partial: CircleDashed,
  connected: Link2,
  complete: BadgeCheck,
};

/**
 * WHY: how far an app's integration has got (computed by the API, ADR 0013), as one pill. The
 * words carry the meaning (never colour alone); `title` says what the next level needs.
 */
export function IntegrationLevelBadge({ level }: { level: IntegrationLevel }) {
  const copy = LEVEL_COPY[level];
  const Icon = LEVEL_ICONS[level];
  return (
    <Badge variant={copy.tone} title={copy.description}>
      <Icon aria-hidden="true" />
      {copy.label}
    </Badge>
  );
}
