/* global __ENV, open */
/**
 * k6 (BE-S7-09): tải beta — 200 người dùng chat đồng thời (WebSocket `/ws`) + 50 req/s API chung (HTTP).
 * Ngưỡng: p95 HTTP (kịch bản `api`) < 300 ms, p95 thời gian ack tin chat < 300 ms, lỗi < 1%.
 *
 * Dữ liệu: `LOAD_USERS_FILE` = JSON do `tests/e2e/src/seed-load.ts` tạo (người dùng đã ở `DATING`, có hội thoại mở).
 * Biến môi trường:
 *   K6_BASE_URL       gốc API (local: http://localhost:3100, k6 trong Docker: http://host.docker.internal:3100)
 *   LOAD_USERS_FILE   đường dẫn file người dùng ảo
 *   CHAT_VUS          số người chat đồng thời (mặc định = số người dùng trong file, tối đa 200)
 *   CHAT_INTERVAL_MS  mỗi người gửi 1 tin / khoảng này (mặc định 4000 → 15 tin/phút, dưới hạn mức 30 tin/phút)
 *   API_RPS           tốc độ request API chung (mặc định 50)
 *   LOAD_DURATION     thời lượng (mặc định 3m)
 *
 * Không có `export default`: mọi kịch bản khai báo `exec` riêng (repo cấm default export).
 */
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';
import ws from 'k6/ws';

const BASE_URL = (__ENV.K6_BASE_URL || 'http://localhost:3100').replace(/\/+$/, '');
const WS_URL = `${BASE_URL.replace(/^http/, 'ws')}/ws`;
const users = new SharedArray('users', () => JSON.parse(open(__ENV.LOAD_USERS_FILE)));
const CHAT_VUS = Math.min(Number(__ENV.CHAT_VUS || users.length), users.length, 200);
const CHAT_INTERVAL_MS = Number(__ENV.CHAT_INTERVAL_MS || 4000);
const API_RPS = Number(__ENV.API_RPS || 50);
const DURATION = __ENV.LOAD_DURATION || '3m';

/** Thời lượng dạng `3m` / `90s` → ms (cho vòng đời socket). */
function durationMs(value) {
  const match = /^(\d+)(ms|s|m|h)$/.exec(value);
  if (!match) throw new Error(`LOAD_DURATION không hợp lệ: ${value}`);
  return Number(match[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2]];
}

const wsAckMs = new Trend('ws_ack_ms', true);
const wsConnectMs = new Trend('ws_connect_ms', true);
const wsMessagesSent = new Counter('ws_messages_sent');
const wsMessagesAcked = new Counter('ws_messages_acked');
const wsMessagesReceived = new Counter('ws_messages_received');
const wsErrors = new Counter('ws_errors');

export const options = {
  scenarios: {
    chat: {
      executor: 'per-vu-iterations',
      exec: 'chat',
      vus: CHAT_VUS,
      iterations: 1,
      maxDuration: `${Math.ceil(durationMs(DURATION) / 1000) + 60}s`,
    },
    api: {
      executor: 'constant-arrival-rate',
      exec: 'api',
      rate: API_RPS,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 50,
      maxVUs: 300,
      startTime: '10s', // để 200 socket kết nối xong trước
    },
  },
  thresholds: {
    'http_req_duration{scenario:api}': ['p(95)<300'],
    'http_req_failed{scenario:api}': ['rate<0.01'],
    ws_ack_ms: ['p(95)<300'],
    ws_errors: ['count<1'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const headersOf = (user) => ({
  authorization: `Bearer ${user.accessToken}`,
  'x-forwarded-for': user.forwardedFor,
});

/** Một người dùng ảo: mở socket, vào hội thoại, gửi tin đều đặn, đo thời gian tới `message.ack`. */
export function chat() {
  const user = users[exec.scenario.iterationInTest % users.length];
  const lifetime = durationMs(DURATION);
  const pending = {};
  const connectStartedAt = Date.now();

  const res = ws.connect(WS_URL, { headers: headersOf(user) }, (socket) => {
    socket.on('message', (raw) => {
      const event = JSON.parse(raw);
      if (event.type === 'ready') {
        wsConnectMs.add(Date.now() - connectStartedAt);
        socket.send(JSON.stringify({ type: 'conversation.join', conversationId: user.conversationId }));
      } else if (event.type === 'conversation.joined') {
        // Lệch pha để 200 người không gửi cùng một nhịp.
        socket.setTimeout(() => {
          socket.setInterval(() => {
            const clientMessageId = uuidv4();
            pending[clientMessageId] = Date.now();
            wsMessagesSent.add(1);
            socket.send(
              JSON.stringify({
                type: 'message.send',
                conversationId: user.conversationId,
                clientMessageId,
                body: `k6 load ${clientMessageId.slice(0, 8)}`,
              }),
            );
          }, CHAT_INTERVAL_MS);
        }, Math.random() * CHAT_INTERVAL_MS);
      } else if (event.type === 'message.ack') {
        const sentAt = pending[event.clientMessageId];
        if (sentAt !== undefined) {
          wsAckMs.add(Date.now() - sentAt);
          wsMessagesAcked.add(1);
          delete pending[event.clientMessageId];
        }
      } else if (event.type === 'message.new') {
        wsMessagesReceived.add(1);
      } else if (event.type === 'error') {
        wsErrors.add(1, { code: String(event.code) });
      }
    });
    socket.on('error', () => wsErrors.add(1, { code: 'SOCKET_ERROR' }));
    socket.setTimeout(() => socket.close(1000), lifetime);
  });
  check(res, { 'ws upgrade 101': (r) => r && r.status === 101 });
}

/** API chung: các màn người dùng mở thường xuyên (trang chủ, match, hộp thư, lịch sử chat, voucher, quán). */
const API_CALLS = [
  { weight: 25, name: 'GET /me', path: () => '/me' },
  { weight: 20, name: 'GET /me/match', path: () => '/me/match' },
  { weight: 20, name: 'GET /me/conversations', path: () => '/me/conversations' },
  {
    weight: 20,
    name: 'GET /me/conversations/:id/messages',
    path: (u) => `/me/conversations/${u.conversationId}/messages?limit=20`,
  },
  { weight: 10, name: 'GET /me/vouchers', path: () => '/me/vouchers' },
  { weight: 5, name: 'GET /partners', path: () => '/partners' },
];
const TOTAL_WEIGHT = API_CALLS.reduce((sum, c) => sum + c.weight, 0);

export function api() {
  const user = users[Math.floor(Math.random() * users.length)];
  let pick = Math.random() * TOTAL_WEIGHT;
  const call = API_CALLS.find((c) => (pick -= c.weight) < 0) || API_CALLS[0];
  const res = http.get(`${BASE_URL}${call.path(user)}`, {
    headers: headersOf(user),
    tags: { name: call.name },
  });
  check(res, { 'api 2xx': (r) => r.status >= 200 && r.status < 300 });
}
