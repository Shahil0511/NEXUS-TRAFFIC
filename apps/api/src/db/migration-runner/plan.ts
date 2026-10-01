/**
 * PURE comparison of the files on disk with the ledger. No I/O, so every rule is unit-tested.
 *
 * - pending:        on disk, not applied → apply (runner) / refuse to boot (guard).
 * - drifted:        applied, but the file's checksum changed → ALWAYS fatal (never edit an applied file).
 * - unknownApplied: applied, but no such file → DB is ahead of the code (e.g. `git checkout <old>`
 *                   rollback). Warning only, so rollbacks of additive migrations keep working.
 * - outOfOrder:     pending files whose version is lower than the newest applied one (two branches
 *                   merged). Warning only; they are still applied, in version order.
 */
import type { AppliedMigration } from './ledger';
import type { MigrationFile } from './loader';

export interface DriftedMigration {
  file: MigrationFile;
  applied: AppliedMigration;
}

export interface MigrationPlan {
  pending: MigrationFile[];
  drifted: DriftedMigration[];
  unknownApplied: AppliedMigration[];
  outOfOrder: MigrationFile[];
}

/** Builds the plan; `files` and `applied` may arrive in any order. */
export function planMigrations(files: MigrationFile[], applied: AppliedMigration[]): MigrationPlan {
  const appliedByVersion = new Map(applied.map((a) => [a.version, a]));
  const fileVersions = new Set(files.map((f) => f.version));
  const sortedFiles = [...files].sort((a, b) => a.version.localeCompare(b.version));

  const pending = sortedFiles.filter((f) => !appliedByVersion.has(f.version));
  const drifted = sortedFiles.flatMap((file) => {
    const record = appliedByVersion.get(file.version);
    return record && record.checksum !== file.checksum ? [{ file, applied: record }] : [];
  });
  const unknownApplied = applied
    .filter((a) => !fileVersions.has(a.version))
    .sort((a, b) => a.version.localeCompare(b.version));

  const newestApplied = applied.reduce<string>((max, a) => (a.version > max ? a.version : max), '');
  const outOfOrder = pending.filter((f) => f.version < newestApplied);

  return { pending, drifted, unknownApplied, outOfOrder };
}
