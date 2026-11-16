import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as constants from '../constants.js';

const agentsMd = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../AGENTS.md'),
  'utf8',
);

/** Đọc bảng hằng số trong AGENTS.md mục 6: dòng dạng "| `NAME` | 299_000 | ... |". */
function constantsFromAgentsMd(): Record<string, number> {
  const section = agentsMd.split(/^## 6\./m)[1]?.split(/^## 7\./m)[0] ?? '';
  const rows = [...section.matchAll(/^\|\s*`([A-Z0-9_]+)`\s*\|\s*([\d_]+)\s*\|/gm)];
  return Object.fromEntries(rows.map(([, name, value]) => [name, Number(value?.replaceAll('_', ''))]));
}

describe('hằng số nghiệp vụ', () => {
  it('khớp hoàn toàn với bảng AGENTS.md mục 6 (AC1)', () => {
    const fromDocs = constantsFromAgentsMd();
    expect(Object.keys(fromDocs).length).toBeGreaterThan(10);
    expect({ ...constants }).toEqual(fromDocs);
  });

  it('giá trị cốt lõi của luồng mai mối', () => {
    expect(constants.OFFER_TTL_HOURS).toBe(24);
    expect(constants.DATING_DAYS).toBe(14);
    expect(constants.COOLDOWN_DAYS).toBe(7);
    expect(constants.VOUCHER_VND - constants.DEPOSIT_VND).toBe(1_000);
  });
});
