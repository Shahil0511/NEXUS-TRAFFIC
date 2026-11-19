import { INGEST_CONTRACT_VERSION, SDK_DEFAULTS, sdkRemoteConfigSchema } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { appRow } from '../../test/ingest-fixtures';
import { toSdkRemoteConfig } from './sdk-config';

describe('toSdkRemoteConfig', () => {
  it('maps the stored switches to the wire config (enabled is always true on a 200)', () => {
    const config = toSdkRemoteConfig(
      appRow({ sdk_config_version: 4, sdk_disabled_modules: ['auto_tools', 'retry_queue'] }),
    );
    expect(config).toEqual({
      contract: INGEST_CONTRACT_VERSION,
      version: 4,
      enabled: true,
      disabledModules: ['auto_tools', 'retry_queue'],
      maxAgeMs: SDK_DEFAULTS.browser.configMaxAgeMs,
    });
    expect(sdkRemoteConfigSchema.parse(config)).toEqual(config);
  });

  it('defaults: version 1, nothing disabled', () => {
    expect(toSdkRemoteConfig(appRow())).toMatchObject({ version: 1, disabledModules: [] });
  });
});
