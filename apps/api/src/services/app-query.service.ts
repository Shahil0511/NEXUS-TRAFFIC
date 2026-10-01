/**
 * Read side of app management: the Apps page list (apps + their keys, no secrets).
 */
import type { AppDto } from '@nexus/shared';

import { mapApp } from '../domain/mappers';
import type { ApiKeyRow } from '../domain/rows';
import type { ApiKeyRepository } from '../repositories/api-key.repository';
import type { AppRepository } from '../repositories/app.repository';

/** WHY: groups keys by app once, so the list costs exactly two queries whatever the app count. */
function groupByAppId(keys: ApiKeyRow[]): Map<string, ApiKeyRow[]> {
  const groups = new Map<string, ApiKeyRow[]>();
  for (const key of keys) {
    const group = groups.get(key.app_id);
    if (group) group.push(key);
    else groups.set(key.app_id, [key]);
  }
  return groups;
}

/** WHY: ROUTES.apps.list — any dashboard user may see which apps exist and their key metadata. */
export class AppQueryService {
  constructor(
    private readonly apps: AppRepository,
    private readonly apiKeys: ApiKeyRepository,
  ) {}

  /**
   * Two queries (apps, then all their keys in ONE call), never N+1.
   * @see ../repositories/app.repository.ts AppRepository.list
   * @see ../repositories/api-key.repository.ts ApiKeyRepository.listByAppIds
   */
  async list(): Promise<AppDto[]> {
    const apps = await this.apps.list();
    if (apps.length === 0) return [];
    const keysByApp = groupByAppId(await this.apiKeys.listByAppIds(apps.map((app) => app.id)));
    return apps.map((app) => mapApp(app, keysByApp.get(app.id) ?? []));
  }
}
