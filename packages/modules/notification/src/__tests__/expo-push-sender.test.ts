import { describe, expect, it } from 'vitest';
import type { PushMessage } from '../application/ports/push-sender.js';
import { EXPO_PUSH_URL, ExpoPushError, ExpoPushSender } from '../infrastructure/expo-push-sender.js';

const msg = (i: number): PushMessage => ({
  token: `ExponentPushToken[t${i}]`,
  title: 'Bạn có tin nhắn mới',
  body: 'Mở Tâm Giao để đọc tin nhắn.',
  data: { kind: 'MESSAGE_RECEIVED', conversationId: 'c1' },
});

interface Call {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: { to: string; title: string; body: string; data: unknown; sound: string }[];
}

function fakeFetch(respond: (call: Call) => Response): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const call: Call = {
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string) as Call['body'],
    };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

const okTickets = (call: Call) =>
  Response.json({ data: call.body.map((_, i) => ({ status: 'ok', id: `r${i}` })) });

describe('ExpoPushSender', () => {
  it('gửi đúng định dạng Expo, ticket ok → OK; kèm access token khi cấu hình', async () => {
    const f = fakeFetch(okTickets);
    const sender = new ExpoPushSender({ fetch: f.fetch, accessToken: 'secret' });
    expect(await sender.send([msg(1)])).toEqual([{ status: 'OK' }]);
    expect(f.calls).toHaveLength(1);
    const [call] = f.calls;
    expect(call?.url).toBe(EXPO_PUSH_URL);
    expect(call?.headers.authorization).toBe('Bearer secret');
    expect(call?.body).toEqual([
      {
        to: 'ExponentPushToken[t1]',
        title: 'Bạn có tin nhắn mới',
        body: 'Mở Tâm Giao để đọc tin nhắn.',
        data: { kind: 'MESSAGE_RECEIVED', conversationId: 'c1' },
        sound: 'default',
        priority: 'high',
      },
    ]);
  });

  it('DeviceNotRegistered → INVALID_TOKEN; MessageRateExceeded → lỗi tạm thời; lỗi khác → vĩnh viễn', async () => {
    const f = fakeFetch(() =>
      Response.json({
        data: [
          { status: 'ok', id: 'a' },
          { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } },
          { status: 'error', message: 'x', details: { error: 'MessageRateExceeded' } },
          { status: 'error', message: 'x', details: { error: 'MessageTooBig' } },
          { status: 'error', message: 'x' },
        ],
      }),
    );
    const sender = new ExpoPushSender({ fetch: f.fetch });
    expect(await sender.send([msg(1), msg(2), msg(3), msg(4), msg(5)])).toEqual([
      { status: 'OK' },
      { status: 'INVALID_TOKEN' },
      { status: 'ERROR', retryable: true, code: 'MessageRateExceeded' },
      { status: 'ERROR', retryable: false, code: 'MessageTooBig' },
      { status: 'ERROR', retryable: false, code: 'UNKNOWN' },
    ]);
    expect(f.calls[0]?.headers.authorization).toBeUndefined();
  });

  it('chia lô 100 thông báo / request, giữ thứ tự kết quả', async () => {
    const f = fakeFetch(okTickets);
    const sender = new ExpoPushSender({ fetch: f.fetch });
    const outcomes = await sender.send(Array.from({ length: 250 }, (_, i) => msg(i)));
    expect(outcomes).toHaveLength(250);
    expect(f.calls.map((c) => c.body.length)).toEqual([100, 100, 50]);
    expect(f.calls[2]?.body[0]?.to).toBe('ExponentPushToken[t200]');
  });

  it('HTTP lỗi / thiếu ticket / lỗi mạng → ExpoPushError (job thử lại)', async () => {
    await expect(
      new ExpoPushSender({ fetch: fakeFetch(() => new Response('busy', { status: 503 })).fetch }).send([
        msg(1),
      ]),
    ).rejects.toBeInstanceOf(ExpoPushError);
    await expect(
      new ExpoPushSender({ fetch: fakeFetch(() => Response.json({ data: [] })).fetch }).send([msg(1)]),
    ).rejects.toThrow('ticket');
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(new ExpoPushSender({ fetch: failing }).send([msg(1)])).rejects.toBeInstanceOf(ExpoPushError);
  });

  it('không có thông báo → không gọi Expo', async () => {
    const f = fakeFetch(okTickets);
    expect(await new ExpoPushSender({ fetch: f.fetch }).send([])).toEqual([]);
    expect(f.calls).toHaveLength(0);
  });
});
