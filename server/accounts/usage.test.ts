import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import { AccountsService } from './service';

describe('Claude account without a usage source', () => {
  it('has usage undefined (unknown), never a zero percentage', () => {
    const tmp = tempDir();
    try {
      const dir = join(tmp.dir, '.claude');
      mkdirSync(join(dir, 'sessions'), { recursive: true });
      const svc = new AccountsService({ dirs: [dir], home: tmp.dir, env: {}, onChange: () => {} });
      const [info] = svc.list(new Map());
      expect(info.usage).toBeUndefined();
      expect(info.usageStatus).toBe('disabled');
    } finally {
      tmp.cleanup();
    }
  });
});
