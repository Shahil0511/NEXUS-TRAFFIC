/**
 * WHY: pages state their numbers in a headline sentence (components/HeadlineSentence) or a facts
 * list, not a row of KPI cards. This guard lists the views that still import KpiCard; a view that
 * drops it must leave the list, and no new view may start using it. DeltaPill / DeltaPolarity
 * (also exported by components/KpiCard.tsx) are allowed everywhere.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC_DIR = path.resolve(__dirname, '..');
const FEATURES_DIR = path.resolve(__dirname);

/**
 * WHY: the views that still have a KPI card row, relative to apps/web/src, sorted. This list
 * ONLY SHRINKS: a view that drops KpiCard is removed here; NEVER add one.
 */
const KPI_CARD_ALLOW_LIST = [
  'features/applications/ApplicationDetailView.tsx',
  'features/endpoints/EndpointDetailView.tsx',
  'features/errors/ErrorsView.tsx',
  'features/journeys/SessionDetailView.tsx',
  'features/live/LiveView.tsx',
  'features/overview/OverviewView.tsx',
  'features/pages/PageDetailView.tsx',
  'features/tools/ToolDetailView.tsx',
  'features/users/UserDayDetail.tsx',
  'features/users/UserDaysOverview.tsx',
  'features/users/UserDetailView.tsx',
  'features/users/UserSummaryTab.tsx',
] as const;

/**
 * `import { … } from '…/components/KpiCard'` (alias or relative, optional `.tsx`) and the same as
 * `export { … } from` (a re-export) — the specifier list is group 1 (may span lines).
 */
const KPI_CARD_IMPORT =
  /(?:import|export)\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"](?:@\/|(?:\.\.?\/)+)(?:[\w/]*\/)?components\/KpiCard(?:\.tsx)?['"]/g;

/** Every non-test .tsx file under `dir`, recursively, as absolute paths. */
function listViews(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listViews(full);
    return entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [full] : [];
  });
}

/** Whether a source's KpiCard import names KpiCard itself (not only DeltaPill / DeltaPolarity). */
function importsKpiCard(source: string): boolean {
  return [...source.matchAll(KPI_CARD_IMPORT)].some((match) =>
    (match[1] ?? '')
      .split(',')
      .map((specifier) => specifier.trim().replace(/^type\s+/, ''))
      .some((specifier) => specifier === 'KpiCard' || specifier.startsWith('KpiCard ')),
  );
}

const usingKpiCard = listViews(FEATURES_DIR)
  .filter((file) => importsKpiCard(readFileSync(file, 'utf8')))
  .map((file) => path.relative(SRC_DIR, file).replace(/\\/g, '/'))
  .sort();

describe('importsKpiCard', () => {
  it('counts KpiCard imported by alias, relative path, with an extension, or re-exported', () => {
    expect(importsKpiCard(`import { KpiCard } from '@/components/KpiCard';`)).toBe(true);
    expect(
      importsKpiCard(`import {
  DeltaPill,
  KpiCard,
} from '../../components/KpiCard';`),
    ).toBe(true);
    expect(importsKpiCard(`import { KpiCard } from './components/KpiCard';`)).toBe(true);
    expect(importsKpiCard(`import { KpiCard as Card } from '@/components/KpiCard.tsx';`)).toBe(
      true,
    );
    expect(importsKpiCard(`export { KpiCard } from '@/components/KpiCard';`)).toBe(true);
  });

  it('does not count DeltaPill / DeltaPolarity alone, or another module', () => {
    expect(
      importsKpiCard(`import { DeltaPill, type DeltaPolarity } from '../components/KpiCard';`),
    ).toBe(false);
    expect(importsKpiCard(`import { KpiCardish } from '@/components/KpiCardish';`)).toBe(false);
  });
});

describe('no KPI card rows outside the shrinking allow-list', () => {
  it('lets no view outside the list import KpiCard', () => {
    const allowed = new Set<string>(KPI_CARD_ALLOW_LIST);
    expect(usingKpiCard.filter((file) => !allowed.has(file))).toEqual([]);
  });

  it('keeps the list honest: every listed view still imports KpiCard (else remove it)', () => {
    const using = new Set(usingKpiCard);
    expect(KPI_CARD_ALLOW_LIST.filter((file) => !using.has(file))).toEqual([]);
  });
});
