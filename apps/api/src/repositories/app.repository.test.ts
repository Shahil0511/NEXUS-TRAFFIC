import { describe, expect, it } from 'vitest';

import { ParamList } from '../db/sql';
import { buildAppPatchSet } from './app.repository';

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
