import {
  IDEMPOTENCY_KEY_HEADER,
  createVerificationCheckoutBodySchema,
  devFakePaymentBodySchema,
  idempotencyKeySchema,
  type PaymentHistoryResponse,
  type VerificationCheckoutResponse,
  type WebhookAckResponse,
} from '@tamgiao/contracts';
import { parseBody, problemResponse, sendResult, type AppEnv } from '@tamgiao/http';
import { domainError, err, ok, type DomainError, type Money, type Result } from '@tamgiao/kernel';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import type { CreateVerificationCheckout } from '../application/payment/create-verification-checkout.js';
import type { HandlePaymentWebhook, WebhookResult } from '../application/payment/handle-payment-webhook.js';
import type { GetMyPayments } from '../application/payment/payment-queries.js';
import type { WebhookPaymentStatus } from '../application/ports/payment-gateway.js';

/** Giả lập kết quả thanh toán (chỉ gateway `fake`, không phải production) — trả webhook đã ký. */
export interface DevPaymentSimulator {
  simulatePayment(
    orderId: string,
    outcome: WebhookPaymentStatus,
  ): { readonly headers: Readonly<Record<string, string>>; readonly rawBody: string };
}

export interface PaymentRoutesDeps {
  readonly createCheckout: CreateVerificationCheckout;
  readonly getMyPayments: GetMyPayments;
  readonly handleWebhook: HandlePaymentWebhook;
  /** Tên cổng đang cấu hình — `POST /webhooks/payments/:gateway` khác tên này → 404. */
  readonly gatewayName: string;
  readonly requireUser: MiddlewareHandler<AppEnv>;
  /** Có → mount `POST /dev/payments/fake/:orderId` (composition root chỉ truyền khi gateway `fake` + không production). */
  readonly devSimulator?: DevPaymentSimulator | undefined;
}

const toVnd = (money: Money): number => Number(money.amount);

/**
 * Route thanh toán xác thực (BE-S4-03): `POST /me/payments/verification`, `GET /me/payments`,
 * `POST /webhooks/payments/:gateway` (không auth — xác thực bằng chữ ký trên raw body).
 */
export function createPaymentRoutes(deps: PaymentRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.post('/me/payments/verification', deps.requireUser, async (c) => {
    const key = await readIdempotencyKey(c);
    if (key.isErr()) return key.error;
    const result = await deps.createCheckout.execute({
      userId: c.get('auth').userId,
      idempotencyKey: key.value,
    });
    if (result.isErr()) return problemResponse(c, result.error);
    const v = result.value;
    const body: VerificationCheckoutResponse = {
      paymentId: v.paymentId,
      orderId: v.orderId,
      status: v.status,
      amountVnd: toVnd(v.amount),
      checkoutUrl: v.checkout.checkoutUrl,
      qrData: v.checkout.qrData,
      createdAt: v.createdAt.toISOString(),
    };
    return c.json(body, v.created ? 201 : 200);
  });

  routes.get('/me/payments', deps.requireUser, async (c) => {
    const items = await deps.getMyPayments.execute(c.get('auth').userId);
    const body: PaymentHistoryResponse = {
      items: items.map((p) => ({
        paymentId: p.paymentId,
        orderId: p.orderId,
        status: p.status,
        amountVnd: toVnd(p.amount),
        checkoutUrl: p.checkout?.checkoutUrl ?? null,
        qrData: p.checkout?.qrData ?? null,
        createdAt: p.createdAt.toISOString(),
        succeededAt: p.succeededAt?.toISOString() ?? null,
        failedAt: p.failedAt?.toISOString() ?? null,
        refundedAt: p.refundedAt?.toISOString() ?? null,
      })),
    };
    return sendResult(c, ok(body));
  });

  routes.post('/webhooks/payments/:gateway', async (c) => {
    if (c.req.param('gateway') !== deps.gatewayName) return problemResponse(c, domainError('NOT_FOUND'));
    // Raw body: chữ ký tính trên đúng các byte cổng gửi, không parse JSON trước khi verify.
    const rawBody = await c.req.text();
    const result = await deps.handleWebhook.execute({ headers: c.req.header(), rawBody });
    return respondWebhook(c, result);
  });

  const simulator = deps.devSimulator;
  if (simulator !== undefined) {
    routes.post('/dev/payments/fake/:orderId', async (c) => {
      const body = await parseBody(c, devFakePaymentBodySchema);
      if (body.isErr()) return body.error;
      let webhook: ReturnType<DevPaymentSimulator['simulatePayment']>;
      try {
        webhook = simulator.simulatePayment(c.req.param('orderId'), body.value.outcome);
      } catch {
        // Cổng giả chỉ biết đơn đã `createCheckout` trong tiến trình hiện tại.
        return problemResponse(c, domainError('NOT_FOUND'));
      }
      const result = await deps.handleWebhook.execute({ headers: webhook.headers, rawBody: webhook.rawBody });
      return respondWebhook(c, result);
    });
  }

  return routes;
}

/** Ack 200 cho mọi webhook hợp lệ chữ ký (kể cả lặp/không khớp) để cổng không gửi lại; log bất thường (không PII). */
function respondWebhook(c: Context<AppEnv>, result: Result<WebhookResult, DomainError>): Response {
  if (result.isErr()) return problemResponse(c, result.error);
  const r = result.value;
  const logger = c.get('logger');
  const fields = {
    outcome: r.outcome,
    orderId: r.orderId,
    gatewayTxnId: r.gatewayTxnId,
    paymentId: r.paymentId,
    paymentStatus: r.paymentStatus,
  };
  if (r.outcome === 'AMOUNT_MISMATCH' || r.outcome === 'IGNORED') {
    logger.error(fields, 'payment webhook not applied');
  } else if (r.outcome === 'UNKNOWN_ORDER') {
    logger.warn(fields, 'payment webhook for unknown order');
  } else {
    logger.info(fields, 'payment webhook processed');
  }
  const body: WebhookAckResponse = { received: true, outcome: r.outcome };
  return c.json(body, 200);
}

/** Idempotency key từ header `Idempotency-Key` hoặc body `idempotencyKey` (cả hai thì phải trùng). */
async function readIdempotencyKey(c: Context<AppEnv>): Promise<Result<string, Response>> {
  const invalid = (detail: string): Result<string, Response> =>
    err(problemResponse(c, domainError('VALIDATION_FAILED'), { detail }));
  const header = c.req.header(IDEMPOTENCY_KEY_HEADER);
  let fromBody: string | undefined;
  const text = await c.req.text();
  if (text.trim() !== '') {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return invalid('Body phải là JSON hợp lệ');
    }
    const parsed = createVerificationCheckoutBodySchema.safeParse(raw);
    if (!parsed.success) return invalid('idempotencyKey không hợp lệ');
    fromBody = parsed.data.idempotencyKey;
  }
  if (header !== undefined && !idempotencyKeySchema.safeParse(header).success) {
    return invalid('Header Idempotency-Key không hợp lệ');
  }
  if (header !== undefined && fromBody !== undefined && header !== fromBody) {
    return invalid('Idempotency-Key ở header và body không trùng nhau');
  }
  const key = header ?? fromBody;
  if (key === undefined) return invalid('Thiếu Idempotency-Key');
  return ok(key);
}
