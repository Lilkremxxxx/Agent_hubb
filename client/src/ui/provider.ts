// Which tool each item belongs to (Claude Code or Antigravity) and texts that change with it. Pure (no DOM): tested in
// ui/provider.test.ts. In the protocol, missing `provider` means Claude Code (shared/types.ts);
// everything defaults to that here.
import type { AccountInfo, Provider } from '../../../shared/types';
import { shortcutHint } from './model';
import { tr } from '../../../shared/i18n';

/** Name of each tool as displayed in UI text. */
export const PROVIDER_NAME: Record<Provider, string> = { claude: 'Claude Code', agy: 'Antigravity' };

/** Tool of an agent, account, session, or request (absent = Claude Code). */
export function providerOf(x: { provider?: Provider } | null | undefined): Provider {
  return x?.provider ?? 'claude';
}

/** Account tool: from snapshot; without it, caller hint or Claude Code. */
export function accountProvider(account: Pick<AccountInfo, 'provider'> | undefined, hint?: Provider): Provider {
  if (account) return providerOf(account);
  return hint ?? 'claude';
}

/**
 * Letter for a chip of an account not in the snapshot: first letter after the folder prefix
 * (".claude-conta2" -> "C"). The default folder (".claude") becomes "?". Never returns "." or empty.
 */
export function fallbackShort(id: string): string {
  const rest = id
    .replace(/^.*:/, '')
    .replace(/~\d+$/, '')
    .replace(/^\.?claude(?=[-_.]|$)[-_.]?/i, '');
  const letter = /[\p{L}\p{N}]/u.exec(rest)?.[0];
  if (letter) return letter.toUpperCase();
  return '?';
}

/** Tool badge next to account name (Antigravity only; omitted when name already mentions it). */
export function showsProviderTag(provider: Provider, accountName = ''): boolean {
  if (provider === 'claude') return false;
  const name = accountName.toLowerCase();
  // Antigravity workers are named "alice (Agy)": the name already says it.
  if (provider === 'agy' && name.includes('(agy)')) return false;
  return !name.includes(PROVIDER_NAME[provider].toLowerCase());
}

/** Account chip label (tooltip and screen readers): "Account C (dev@x.com)". */
export function accountChipLabel(account: Pick<AccountInfo, 'name' | 'email'> | undefined, fallbackId: string): string {
  if (!account) return fallbackId || tr('Unknown account');
  return `${account.name}${account.email ? ` (${account.email})` : ''}`;
}

/** Empty office text: shortcuts ("shortcuts c or d") are derived from shell aliases of Claude Code accounts. */
export function emptyOfficeHint(accounts: readonly Pick<AccountInfo, 'short'>[]): string {
  const keys = shortcutHint(accounts);
  return tr('Open Claude Code in any project{0} and watch your agent arrive.', [keys ? ` (${keys})` : '']);
}
