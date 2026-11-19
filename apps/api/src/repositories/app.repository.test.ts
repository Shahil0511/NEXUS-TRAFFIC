import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { ParamList } from '../db/sql';
import { AppRepository, buildAppPatchSet } from './app.repository';

/** Records every statement; answers with no rows. */
class RecordingExecutor {
  readonly statements: Array<{ text: string; values: unknown[] }> = [];
  async query(text: string, values: unknown[] = []) {
    this.statements.push({ text, values });
    return { rows: [] };
  }
}

describe('buildAppPatchSet', () => {
  it('sets only provided fields, keeping explicit null and false', () => {
    const params = new ParamList();
    const set = buildAppPatchSet({ displayName: 'X', basePath: null, isActive: false }, params);
    expect(set).toEqual(['display_name = $1', 'base_path = $2', 'is_active = $3']);
    expect(params.values).toEqual(['X', null, false]);
  });

  it('returns nothing for an empty patch', () => {
    expect(buildAppPatchSet({}, new ParamList())).toEqual([]);
  });
});

describe('AppRepository.updateSdkConfig', () => {
  it('is a conditional UPDATE on the expected version that bumps it, null on a mismatch', async () => {
    const exec = new RecordingExecutor();
    const repo = new AppRepository(exec as unknown as Pool);
    const row = await repo.updateSdkConfig('app-id', ['retry_queue'], 3);
    expect(row).toBeNull();
    const [statement] = exec.statements;
    const sql = statement?.text.replace(/\s+/g, ' ') ?? '';
    expect(sql).toContain('sdk_config_version = sdk_config_version + 1');
    expect(sql).toContain('WHERE id = $1 AND sdk_config_version = $3');
    expect(sql).toContain('sdk_disabled_modules = $2::text[]');
    expect(sql).toContain('RETURNING');
    expect(sql).toContain('sdk_config_updated_at');
    expect(statement?.values).toEqual(['app-id', ['retry_queue'], 3]);
  });

  it('selects the sdk config columns with every app read', async () => {
    const exec = new RecordingExecutor();
    await new AppRepository(exec as unknown as Pool).findBySlug('ebo-sales');
    for (const column of ['sdk_config_version', 'sdk_disabled_modules', 'sdk_config_updated_at']) {
      expect(exec.statements[0]?.text).toContain(column);
    }
  });
});
