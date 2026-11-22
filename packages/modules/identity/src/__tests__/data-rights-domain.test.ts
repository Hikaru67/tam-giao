import { addDuration, newId } from '@tamgiao/kernel';
import { describe, expect, it } from 'vitest';
import { AccountDeletion, accountDeletionChallengeKey } from '../domain/account-deletion.js';
import { DATA_EXPORT_TTL_HOURS, DataExport } from '../domain/data-export.js';

const NOW = new Date('2026-11-20T08:00:00.000Z');

describe('DataExport (BE-S7-06)', () => {
  it('request → PENDING + DataExportRequested {exportId, userId}', () => {
    const userId = newId();
    const exp = DataExport.request(userId, NOW);
    expect(exp.statusAt(NOW)).toBe('PENDING');
    const [event] = exp.pullEvents();
    expect(event).toMatchObject({
      type: 'DataExportRequested',
      aggregateType: 'DataExport',
      aggregateId: exp.id,
      version: 1,
      payload: { exportId: exp.id, userId },
    });
  });

  it('chưa dựng xong → không tải được (DATA_EXPORT_NOT_READY)', () => {
    const exp = DataExport.request(newId(), NOW);
    const r = exp.checkDownloadable(NOW);
    expect(r.isErr() && r.error.code).toBe('DATA_EXPORT_NOT_READY');
  });

  it('markReady → READY, hạn tải đúng DATA_EXPORT_TTL_HOURS; lần hai no-op', () => {
    const exp = DataExport.request(newId(), NOW);
    expect(exp.markReady(NOW)).toBe(true);
    expect(exp.toState().expiresAt).toEqual(addDuration(NOW, { hours: DATA_EXPORT_TTL_HOURS }));
    expect(DATA_EXPORT_TTL_HOURS).toBe(24);
    expect(exp.checkDownloadable(NOW).isOk()).toBe(true);
    expect(exp.markReady(addDuration(NOW, { hours: 1 }))).toBe(false);
    expect(exp.toState().readyAt).toEqual(NOW);
  });

  it('đúng mốc hết hạn → EXPIRED (DATA_EXPORT_EXPIRED); một ms trước vẫn tải được', () => {
    const exp = DataExport.request(newId(), NOW);
    exp.markReady(NOW);
    const expiresAt = addDuration(NOW, { hours: 24 });
    expect(exp.checkDownloadable(addDuration(expiresAt, { milliseconds: -1 })).isOk()).toBe(true);
    expect(exp.statusAt(expiresAt)).toBe('EXPIRED');
    const r = exp.checkDownloadable(expiresAt);
    expect(r.isErr() && r.error.code).toBe('DATA_EXPORT_EXPIRED');
  });
});

describe('AccountDeletion (BE-S7-06)', () => {
  it('request → AccountDeletionRequested chỉ chứa id + thời điểm; eventId lưu lại để theo dõi tiến độ', () => {
    const userId = newId();
    const deletion = AccountDeletion.request(userId, NOW);
    const events = deletion.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'AccountDeletionRequested',
      aggregateType: 'AccountDeletion',
      aggregateId: deletion.id,
      version: 1,
      payload: { requestId: deletion.id, userId, requestedAt: NOW.toISOString() },
    });
    expect(deletion.eventId).toBe(events[0]?.eventId);
    expect(deletion.toState()).toMatchObject({ userId, requestedAt: NOW, version: 1 });
  });

  it('khoá challenge OTP xoá tài khoản tách khỏi challenge đăng nhập (blind index SĐT)', () => {
    const userId = newId();
    expect(accountDeletionChallengeKey(userId)).toBe(`account-deletion:${userId}`);
  });
});
