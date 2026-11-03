import { describe, expect, it } from 'vitest';
import { accountChipLabel, accountProvider, emptyOfficeHint, fallbackShort, providerOf, showsProviderTag } from './provider';

describe('tool (Claude Code or Antigravity)', () => {
  it('missing provider = Claude Code', () => {
    expect(providerOf(undefined)).toBe('claude');
    expect(providerOf({})).toBe('claude');
    expect(providerOf({ provider: 'agy' })).toBe('agy');
  });

  it('account tool: the snapshot account wins, then the caller hint, then Claude Code', () => {
    expect(accountProvider({ provider: 'agy' })).toBe('agy');
    expect(accountProvider({})).toBe('claude');
    expect(accountProvider(undefined, 'agy')).toBe('agy');
    expect(accountProvider(undefined)).toBe('claude');
  });

  it('chip letter without account in snapshot: never "." or empty', () => {
    expect(fallbackShort('.claude-conta2')).toBe('C');
    expect(fallbackShort('.claude')).toBe('?');
    expect(fallbackShort('minha-conta')).toBe('M');
    expect(fallbackShort('')).toBe('?');
    expect(fallbackShort('...')).toBe('?');
  });

  it('tool tag: only on non-Claude tools, without repeating the account name', () => {
    expect(showsProviderTag('claude', 'Account C')).toBe(false);
    expect(showsProviderTag('agy', 'Antigravity acc1')).toBe(false);
    expect(showsProviderTag('agy', 'alice (Agy)')).toBe(false);
    expect(showsProviderTag('agy', 'Huy')).toBe(true);
  });

  it('chip label: name and email', () => {
    expect(accountChipLabel({ name: 'Account C', email: 'a@b.c' }, '.claude')).toBe('Account C (a@b.c)');
    expect(accountChipLabel({ name: 'Account C' }, '.claude')).toBe('Account C');
    expect(accountChipLabel(undefined, '.claude')).toBe('.claude');
    expect(accountChipLabel(undefined, '')).toBe('Unknown account');
  });

  it('empty office: shortcuts come from the accounts', () => {
    expect(emptyOfficeHint([{ short: 'C' }, { short: 'D' }])).toBe('Open Claude Code in any project (shortcuts c or d) and watch your agent arrive.');
    expect(emptyOfficeHint([])).toBe('Open Claude Code in any project and watch your agent arrive.');
  });
});
