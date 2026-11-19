/**
 * The browser SDK's remote config (POST ROUTES.ingest.config, ADR 0009) from an app row. Pure.
 *
 * WHY here: the config rides the AppKeyCache row (no extra query), and the response shape is one
 * mapping — `enabled` is reserved and always `true` on a 200 (a killed app/key answers 401/403
 * through publishableKeyAuth with an SDK_KILL_ERROR_CODES code instead).
 * @see ../../migrations/0009_app_sdk_config.sql
 */
import { INGEST_CONTRACT_VERSION, SDK_DEFAULTS, type SdkRemoteConfig } from '@nexus/shared';

import type { AppRow } from './rows';

/** WHY: one mapping from the stored module switches to the wire config the SDK obeys. */
export function toSdkRemoteConfig(app: AppRow): SdkRemoteConfig {
  return {
    contract: INGEST_CONTRACT_VERSION,
    version: app.sdk_config_version,
    enabled: true,
    disabledModules: [...app.sdk_disabled_modules],
    maxAgeMs: SDK_DEFAULTS.browser.configMaxAgeMs,
  };
}
