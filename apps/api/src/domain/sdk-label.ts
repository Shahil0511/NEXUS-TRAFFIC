/**
 * Strict normalisation of a sender-chosen SDK label for `traffic.ingest_rejections.sdk` (A9). Pure.
 *
 * WHY strict: the label comes from the X-Nexus-SDK header / envelope and is sender-chosen text. Only
 * a well-formed `name@version` may create a row key; anything else becomes `''` ("unknown"), which
 * also keeps the column CHECK (≤ 100 chars) from failing — and with it the whole upsert.
 * (web_events.sdk / api_requests.sdk keep the lenient `sdkLabel` of enrichment/actor-columns.ts.)
 */
import { INGEST_LIMITS } from '@nexus/shared';

const SDK_LABEL_PATTERN = new RegExp(
  `^[A-Za-z0-9@/._-]{1,${INGEST_LIMITS.maxSdkNameLength}}@[0-9A-Za-z.+-]{1,${INGEST_LIMITS.maxSdkVersionLength}}$`,
);

/** The empty label: "no / unknown SDK" (the column default). */
export const NO_SDK_LABEL = '';

/** WHY: one rule for every rejection row, so the KPI groups by real SDK versions only. */
export function normalizeSdkLabel(raw: string | null | undefined): string {
  if (!raw) return NO_SDK_LABEL;
  return SDK_LABEL_PATTERN.test(raw) ? raw : NO_SDK_LABEL;
}
