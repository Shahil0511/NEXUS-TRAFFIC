import { Bot, CircleHelp, Monitor, Smartphone, Tablet } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { deviceIconOf, deviceLabel, initialsOf, UNKNOWN_FACT } from './personFacts';

describe('person facts', () => {
  it('labels and icons each device type, unknown included', () => {
    expect(deviceLabel('desktop')).toBe('Desktop');
    expect(deviceLabel(null)).toBe(UNKNOWN_FACT);
    expect(deviceIconOf('desktop')).toBe(Monitor);
    expect(deviceIconOf('mobile')).toBe(Smartphone);
    expect(deviceIconOf('tablet')).toBe(Tablet);
    expect(deviceIconOf('bot')).toBe(Bot);
    expect(deviceIconOf('other')).toBe(CircleHelp);
    expect(deviceIconOf(null)).toBe(CircleHelp);
  });

  it('builds neutral initials from the local part of the email', () => {
    expect(initialsOf('anita.sharma@libas.in')).toBe('AS');
    expect(initialsOf('buyer@libas.in')).toBe('B');
    expect(initialsOf('a_b-c@libas.in')).toBe('AB');
    expect(initialsOf('@libas.in')).toBe('?');
  });
});
