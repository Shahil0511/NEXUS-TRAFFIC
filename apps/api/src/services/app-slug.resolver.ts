/**
 * Translates the public `app` slug filter of dashboard queries into the internal app id
 * (cached briefly). Unknown slug → 404, so typos never silently return "all apps".
 */
import { NotFoundError } from '../errors/app-error';
import type { AppRepository } from '../repositories/app.repository';

export class AppSlugResolver {
  private readonly cache = new Map<string, { id: string; at: number }>();

  constructor(
    private readonly apps: AppRepository,
    private readonly ttlMs = 60_000,
  ) {}

  /** undefined slug → undefined (= all apps). */
  async resolve(slug: string | undefined): Promise<string | undefined> {
    if (!slug) return undefined;
    const cached = this.cache.get(slug);
    if (cached && Date.now() - cached.at < this.ttlMs) return cached.id;
    const app = await this.apps.findBySlug(slug);
    if (!app) throw new NotFoundError(`Unknown app "${slug}"`);
    this.cache.set(slug, { id: app.id, at: Date.now() });
    return app.id;
  }
}
