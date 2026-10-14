/**
 * Pure form logic of the Apps admin dialogs: form values ⇄ the SHARED request bodies.
 *
 * WHY: validation uses the very zod schemas the API validates with (`createAppBodySchema`,
 * `updateAppBodySchema`, `createKeyBodySchema` in @nexus/shared), so the form can never accept
 * what the API would refuse — and a schema change shows up here at compile time.
 */
import {
  createAppBodySchema,
  createKeyBodySchema,
  updateAppBodySchema,
  type ApiKeyDto,
  type AppDto,
  type CreateAppBody,
  type CreateKeyBody,
  type KeyKind,
  type UpdateAppBody,
} from '@nexus/shared';
import type { ZodError } from 'zod';

// ─── App form ───────────────────────────────────────────────────────────────

export interface AppFormValues {
  slug: string;
  displayName: string;
  /** Empty = no base path. */
  basePath: string;
  /** One origin per line (commas and spaces also separate). */
  allowedOrigins: string;
  browserIngestEnabled: boolean;
  isActive: boolean;
}

export type AppFormField = keyof AppFormValues;
export type FieldErrors<F extends string> = Partial<Record<F, string>>;

export function emptyAppForm(): AppFormValues {
  return {
    slug: '',
    displayName: '',
    basePath: '',
    allowedOrigins: '',
    browserIngestEnabled: true,
    isActive: true,
  };
}

export function appFormOf(app: AppDto): AppFormValues {
  return {
    slug: app.slug,
    displayName: app.displayName,
    basePath: app.basePath ?? '',
    allowedOrigins: app.allowedOrigins.join('\n'),
    browserIngestEnabled: app.browserIngestEnabled,
    isActive: app.isActive,
  };
}

/** "https://a.in, https://b.in\nhttps://a.in" → ["https://a.in", "https://b.in"] (trimmed, unique). */
export function parseOrigins(text: string): string[] {
  const origins = text
    .split(/[\s,]+/)
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0);
  return [...new Set(origins)];
}

/** zod issues → one message per form field (the first issue wins; origin issues name the line). */
function fieldErrorsOf<F extends string>(issues: ZodError['issues']): FieldErrors<F> {
  const errors: FieldErrors<F> = {};
  for (const issue of issues) {
    const [field, index] = issue.path;
    if (typeof field !== 'string' || field in errors) continue;
    const prefix = typeof index === 'number' ? `Origin ${index + 1}: ` : '';
    errors[field as F] = `${prefix}${issue.message}`;
  }
  return errors;
}

export type FormResult<B, F extends string> =
  { ok: true; body: B } | { ok: false; errors: FieldErrors<F> };

export function toCreateAppBody(values: AppFormValues): FormResult<CreateAppBody, AppFormField> {
  const result = createAppBodySchema.safeParse({
    slug: values.slug.trim(),
    displayName: values.displayName,
    basePath: values.basePath.trim() === '' ? null : values.basePath.trim(),
    allowedOrigins: parseOrigins(values.allowedOrigins),
    browserIngestEnabled: values.browserIngestEnabled,
  });
  return result.success
    ? { ok: true, body: result.data }
    : { ok: false, errors: fieldErrorsOf(result.error.issues) };
}

/** Only the CHANGED fields (the API audits exactly what changed); nothing changed → null body. */
export function toUpdateAppBody(
  values: AppFormValues,
  app: AppDto,
): FormResult<UpdateAppBody | null, AppFormField> {
  const basePath = values.basePath.trim() === '' ? null : values.basePath.trim();
  const origins = parseOrigins(values.allowedOrigins);
  const changes: Record<string, unknown> = {};
  if (values.displayName.trim() !== app.displayName) changes['displayName'] = values.displayName;
  if (basePath !== app.basePath) changes['basePath'] = basePath;
  if (origins.join('\n') !== app.allowedOrigins.join('\n')) changes['allowedOrigins'] = origins;
  if (values.browserIngestEnabled !== app.browserIngestEnabled) {
    changes['browserIngestEnabled'] = values.browserIngestEnabled;
  }
  if (values.isActive !== app.isActive) changes['isActive'] = values.isActive;
  if (Object.keys(changes).length === 0) return { ok: true, body: null };

  const result = updateAppBodySchema.safeParse(changes);
  return result.success
    ? { ok: true, body: result.data }
    : { ok: false, errors: fieldErrorsOf(result.error.issues) };
}

// ─── Key form ───────────────────────────────────────────────────────────────

export interface KeyFormValues {
  kind: KeyKind;
  label: string;
}

export function toCreateKeyBody(
  values: KeyFormValues,
): FormResult<CreateKeyBody, keyof KeyFormValues> {
  const result = createKeyBodySchema.safeParse(values);
  return result.success
    ? { ok: true, body: result.data }
    : { ok: false, errors: fieldErrorsOf(result.error.issues) };
}

// ─── Key status ─────────────────────────────────────────────────────────────

export type KeyStatus = 'active' | 'expiring' | 'expired' | 'revoked';

/** Revoked wins; an expiry in the past = expired, in the future = expiring (grace period). */
export function keyStatusOf(key: ApiKeyDto, nowMs: number): KeyStatus {
  if (key.revokedAt) return 'revoked';
  if (key.expiresAt) return new Date(key.expiresAt).getTime() <= nowMs ? 'expired' : 'expiring';
  return 'active';
}

/** Keys that still authenticate (active or in their grace period). */
export function isUsableKey(key: ApiKeyDto, nowMs: number): boolean {
  const status = keyStatusOf(key, nowMs);
  return status === 'active' || status === 'expiring';
}

/** The newest usable publishable key — what the app's frontend should ship. */
export function currentPublishableKey(app: AppDto, nowMs: number): ApiKeyDto | null {
  return (
    app.keys
      .filter((key) => key.kind === 'publishable' && isUsableKey(key, nowMs))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}

/**
 * The `.env` lines a team can paste as-is (the Apps page's "Copy env snippet") — only the values
 * Nexus actually knows; null when it knows none. Never the secret key: it is shown once only.
 */
export function envSnippet(nexusUrl: string | null, publishableKey: string | null): string | null {
  const lines = [
    nexusUrl ? `NEXUS_URL=${nexusUrl}` : null,
    publishableKey ? `NEXT_PUBLIC_NEXUS_KEY=${publishableKey}` : null,
  ].filter((line): line is string => line !== null);
  return lines.length > 0 ? lines.join('\n') : null;
}

// ─── Expiry (rotation grace) ────────────────────────────────────────────────

export const GRACE_VALUES = ['now', '1h', '24h', '7d'] as const;
export type Grace = (typeof GRACE_VALUES)[number];

const GRACE_MS: Record<Grace, number> = {
  now: 0,
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
};

/** `expiresAt` for ROUTES.apps.expireKey: now + the chosen grace period, as ISO-8601 UTC. */
export function expiresAtFor(grace: Grace, nowMs: number): string {
  return new Date(nowMs + GRACE_MS[grace]).toISOString();
}
