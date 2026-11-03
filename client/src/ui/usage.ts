// Usage texts shared by the Accounts window, the drawer and help: origin of the numbers, card state, how to enable.
// Display rules:
// - stale numbers never pass as current: a window that already reset after reading shows "—" and "reset";
//   old numbers are dimmed with age ("6d ago") in the header or, on mobile, a badge on the chip;
// - reset comes with implicit verb in the ↻ icon and countdown when less than a day remains;
// - account without numbers says "no usage data" and offers "How to enable" (run `/usage`).
import type { AccountInfo } from '../../../shared/types';
import { h } from './dom';
import { providerOf } from './provider';
import { tr } from '../../../shared/i18n';

/**
 * How to enable usage for an account (card tooltip and help).
 * Backticked fragments become code (no line breaks in middle of command).
 */
export const USAGE_SETUP_STEPS: readonly [string, string][] = [
  ['/usage', tr('Without installing anything: run `/usage` in Claude Code on this account to refresh the cache (the numbers go stale until the next time).')],
];

/** Text with `like this` fragments as code. */
export function richText(text: string): Node[] {
  return text.split('`').map((part, i) => (i % 2 ? h('code', { class: 'ui-usage-setup__inline', text: part }) : document.createTextNode(part)));
}

/** Step by step to enable usage (card tooltip and help). */
export function createUsageSetup(): HTMLElement {
  return h(
    'ol',
    { class: 'ui-usage-setup' },
    ...USAGE_SETUP_STEPS.map(([cmd, text]) => h('li', {}, h('code', { class: 'ui-usage-setup__cmd', text: cmd }), h('span', {}, ...richText(text)))),
  );
}

/** ok/stale: recent/old numbers; empty: no numbers. */
export type CardState = 'ok' | 'stale' | 'empty';

function hasWindows(a: Pick<AccountInfo, 'usage'>): boolean {
  return !!a.usage && !!(a.usage.fiveHour || a.usage.sevenDay);
}

/** Effective card state. */
export function cardState(a: Pick<AccountInfo, 'usage' | 'usageStatus'>): CardState {
  // Reading without any windows (e.g.: /usage cache without numbers) counts as "empty".
  if (!hasWindows(a)) return 'empty';
  return a.usageStatus === 'ok' ? 'ok' : 'stale';
}

/** Is the age of numbers always shown? Only when they are stale. */
export function showsUsageAge(a: Pick<AccountInfo, 'usage' | 'usageStatus'>): boolean {
  return !!a.usage && cardState(a) === 'stale';
}

/** Line below name: email, or the config directory. */
export function usageSubtitle(a: Pick<AccountInfo, 'email' | 'configDir'>): string {
  return a.email ?? a.configDir;
}

/** Message in place of bars (states without numbers): [long, short]. */
export function usageMessage(a: Pick<AccountInfo, 'provider'>): [string, string] {
  // Antigravity's usage comes from its /usage, read every few minutes.
  if (providerOf(a) === 'agy') return [tr('no data yet'), tr('no data')];
  return [tr('no usage data'), tr('no data')];
}
