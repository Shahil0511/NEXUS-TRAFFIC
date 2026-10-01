import { describe, expect, it } from 'vitest';

import { apiKeyRow, appRow } from '../../test/fixtures/app-rows';
import type { ApiKeyRow, AppRow } from '../domain/rows';
import type { ApiKeyRepository } from '../repositories/api-key.repository';
import type { AppRepository } from '../repositories/app.repository';
import { AppQueryService } from './app-query.service';

class FakeApps implements Pick<AppRepository, 'list'> {
  constructor(private readonly rows: AppRow[]) {}
  async list(): Promise<AppRow[]> {
    return this.rows;
  }
}

class FakeKeys implements Pick<ApiKeyRepository, 'listByAppIds'> {
  readonly calls: string[][] = [];
  constructor(private readonly rows: ApiKeyRow[]) {}
  async listByAppIds(appIds: string[]): Promise<ApiKeyRow[]> {
    this.calls.push(appIds);
    return this.rows.filter((row) => appIds.includes(row.app_id));
  }
}

function build(apps: AppRow[], keys: ApiKeyRow[]) {
  const fakeKeys = new FakeKeys(keys);
  const service = new AppQueryService(
    new FakeApps(apps) as unknown as AppRepository,
    fakeKeys as unknown as ApiKeyRepository,
  );
  return { service, fakeKeys };
}

describe('AppQueryService.list', () => {
  const appA = appRow({ id: 'a', slug: 'app-a' });
  const appB = appRow({ id: 'b', slug: 'app-b' });
  const appC = appRow({ id: 'c', slug: 'app-c' });

  it('loads all keys in ONE call and groups them per app', async () => {
    const keys = [
      apiKeyRow({ id: 'k1', app_id: 'a' }),
      apiKeyRow({ id: 'k2', app_id: 'b' }),
      apiKeyRow({ id: 'k3', app_id: 'a' }),
    ];
    const { service, fakeKeys } = build([appA, appB, appC], keys);

    const result = await service.list();

    expect(fakeKeys.calls).toEqual([['a', 'b', 'c']]);
    expect(result.map((app) => app.slug)).toEqual(['app-a', 'app-b', 'app-c']);
    expect(result[0]?.keys.map((k) => k.id)).toEqual(['k1', 'k3']);
    expect(result[1]?.keys.map((k) => k.id)).toEqual(['k2']);
    expect(result[2]?.keys).toEqual([]);
  });

  it('skips the key query when there are no apps', async () => {
    const { service, fakeKeys } = build([], []);
    expect(await service.list()).toEqual([]);
    expect(fakeKeys.calls).toEqual([]);
  });
});
