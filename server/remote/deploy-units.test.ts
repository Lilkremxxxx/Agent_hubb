import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const unit = readFileSync(join(__dirname, '..', '..', 'deploy', 'bang-hub.service'), 'utf8');

describe('deploy/bang-hub.service', () => {
  it('PATH starts with the same node dir as ExecStart (so claude/agy and node 25 are found under systemd)', () => {
    const node = /^ExecStart=(\S+)\/node\s/m.exec(unit)?.[1];
    const path = /^Environment=PATH=(\S+)$/m.exec(unit)?.[1]?.split(':') ?? [];
    expect(node).toMatch(/\.nvm\/versions\/node\/v[\d.]+\/bin$/);
    expect(path[0]).toBe(node);
    expect(path).toContain('%h/.local/bin');
    expect(path).toContain('/usr/bin');
  });
});
