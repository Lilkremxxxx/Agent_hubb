// Edits project .env without losing the rest: updates (or removes) only specified keys, preserving order and comments.

/** POSIX single quotes (' becomes '\''). Newlines/NUL cannot be quoted safely in an env file: rejected. */
export function shQuote(v: string): string {
  if (/[\r\n\0]/.test(v)) throw new Error('env value contains a newline');
  return `'${v.replace(/'/g, `'\\''`)}'`;
}

/**
 * `set[k] = value` writes/updates; `null` removes. Duplicate keys are collapsed to one (first occurrence).
 * `{ quote: true }` single-quotes every written value (for files that sh sources or systemd reads).
 */
export function updateEnv(content: string, set: Record<string, string | null>, opts: { quote?: boolean } = {}): string {
  const fmt = (v: string) => (opts.quote ? shQuote(v) : v);
  const lines = content.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    const key = m?.[1];
    if (!key || !(key in set)) {
      out.push(line);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const value = set[key];
    if (value !== null) out.push(`${key}=${fmt(value)}`);
  }
  for (const [key, value] of Object.entries(set)) {
    if (!seen.has(key) && value !== null) out.push(`${key}=${fmt(value)}`);
  }
  return out.length ? `${out.join('\n')}\n` : '';
}

/** Value of a .env key (first occurrence), unquoted. */
export function readEnvValue(content: string, key: string): string | undefined {
  for (const line of content.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (m?.[1] !== key) continue;
    const v = m[2].trim();
    // shQuote form: 'a'\''b' (concatenated single-quoted pieces)
    if (/^'(?:[^']|'\\'')*'$/.test(v)) return v.slice(1, -1).replace(/'\\''/g, "'");
    return v.replace(/^(['"])(.*)\1$/, '$2');
  }
  return undefined;
}

/** Appends names to a comma-separated list (HABBLAUD_ALLOWED_HOSTS), without duplicates. */
export function addToList(current: string | undefined, ...names: string[]): string {
  const list = (current ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const n of names) if (n && !list.includes(n)) list.push(n);
  return list.join(',');
}
