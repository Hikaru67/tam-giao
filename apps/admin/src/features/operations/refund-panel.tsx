import { useState } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import type { AdminRefundResponse } from '@tamgiao/contracts/billing';
import { Badge, Button, Card, Modal, TextField } from '@tamgiao/ui-web';
import { formatDateTime } from '../kyc/format';
import { REFUNDS_COPY } from './copy';
import { useRefundPayment } from './operations-api';

/** Độ dài tối đa lý do hoàn tiền — khớp schema `adminRefundBodySchema` trong `@tamgiao/contracts/billing`. */
export const REFUND_REASON_MAX_LENGTH = 500;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function normalizePaymentId(value: string): string {
  return value.trim().toLowerCase();
}

export function isPaymentUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function RefundPanel() {
  const [paymentId, setPaymentId] = useState('');
  const [reason, setReason] = useState('');
  const [paymentIdError, setPaymentIdError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [refundResult, setRefundResult] = useState<AdminRefundResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refundMutation = useRefundPayment();

  const handleOpenConfirm = () => {
    setErrorMessage(null);
    let hasError = false;

    const normalizedId = normalizePaymentId(paymentId);
    if (!normalizedId) {
      setPaymentIdError(REFUNDS_COPY.paymentIdRequired);
      hasError = true;
    } else if (!isPaymentUuid(normalizedId)) {
      setPaymentIdError(REFUNDS_COPY.paymentIdInvalid);
      hasError = true;
    } else {
      setPaymentIdError(null);
    }

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setReasonError(REFUNDS_COPY.reasonRequired);
      hasError = true;
    } else if (trimmedReason.length > REFUND_REASON_MAX_LENGTH) {
      setReasonError(REFUNDS_COPY.reasonTooLong(REFUND_REASON_MAX_LENGTH));
      hasError = true;
    } else {
      setReasonError(null);
    }

    if (hasError) {
      return;
    }

    setIsConfirmed(false);
    setIsConfirmModalOpen(true);
  };

  const handleConfirmSubmit = async () => {
    const normalizedId = normalizePaymentId(paymentId);
    const trimmedReason = reason.trim();
    setErrorMessage(null);

    try {
      const response = await refundMutation.mutateAsync({
        paymentId: normalizedId,
        body: { reason: trimmedReason },
      });

      // Thành công: hiện thẻ kết quả + reset form
      setRefundResult(response);
      setPaymentId('');
      setReason('');
      setIsConfirmModalOpen(false);
      setIsConfirmed(false);
    } catch (err) {
      // Lỗi: giữ nguyên dữ liệu trong form và hiển thị alert
      setIsConfirmModalOpen(false);
      const errInfo = messageFor(isApiError(err) ? err : { code: 'UNKNOWN' });
      setErrorMessage(errInfo.title);
    }
  };

  const handleReset = () => {
    setRefundResult(null);
    setErrorMessage(null);
  };

  if (refundResult) {
    return (
      <Card className="flex flex-col gap-space-lg max-w-2xl">
        <div className="flex items-center gap-space-sm border-b border-surface-container-high pb-space-sm">
          <Badge tone="success">{REFUNDS_COPY.statusProcessed}</Badge>
          <h2 className="text-title-md font-bold text-on-surface">{REFUNDS_COPY.successTitle}</h2>
        </div>

        <div className="flex flex-col gap-space-md text-body-sm">
          <div>
            <span className="text-secondary block">{REFUNDS_COPY.paymentIdLabel}</span>
            <span className="font-mono font-medium text-on-surface">{refundResult.paymentId}</span>
          </div>

          <div>
            <span className="text-secondary block">{REFUNDS_COPY.statusLabel}</span>
            <span className="font-medium text-on-surface">{REFUNDS_COPY.statusProcessed}</span>
          </div>

          <div>
            <span className="text-secondary block">{REFUNDS_COPY.requestedAtLabel}</span>
            <span className="text-on-surface">{formatDateTime(refundResult.refundRequestedAt)}</span>
          </div>

          <div>
            <span className="text-secondary block">{REFUNDS_COPY.voucherVoidedLabel}</span>
            <span className="text-on-surface">
              {refundResult.voucherVoided ? REFUNDS_COPY.voucherVoidedYes : REFUNDS_COPY.voucherVoidedNo}
            </span>
          </div>
        </div>

        <div className="pt-space-md border-t border-surface-container-high">
          <Button variant="primary" onClick={handleReset}>
            {REFUNDS_COPY.createAnotherBtn}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-space-lg max-w-2xl">
      <h2 className="text-title-md font-bold text-on-surface border-b border-surface-container-high pb-space-sm">
        {REFUNDS_COPY.formTitle}
      </h2>

      {errorMessage ? (
        <div
          role="alert"
          className="p-space-md rounded-lg bg-error-container text-on-error-container text-body-md border border-error font-medium"
        >
          {errorMessage}
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleOpenConfirm();
        }}
        className="flex flex-col gap-space-lg"
      >
        <div className="flex flex-col gap-space-xs">
          <TextField
            label={REFUNDS_COPY.paymentIdLabel}
            placeholder={REFUNDS_COPY.paymentIdPlaceholder}
            value={paymentId}
            onChange={(e) => {
              setPaymentId(e.target.value);
              if (paymentIdError) setPaymentIdError(null);
            }}
            {...(paymentIdError ? { error: paymentIdError } : {})}
          />
        </div>

        <div className="flex flex-col gap-space-xs">
          <label htmlFor="refund-reason" className="text-label-md font-medium text-on-surface">
            {REFUNDS_COPY.reasonLabel}
          </label>
          <textarea
            id="refund-reason"
            rows={4}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (reasonError) setReasonError(null);
            }}
            placeholder={REFUNDS_COPY.reasonPlaceholder}
            className={`w-full p-space-md rounded-md bg-surface-container-lowest text-on-surface text-body-md border transition-colors outline-none focus:ring-2 focus:ring-primary ${
              reasonError
                ? 'border-error focus:border-error'
                : 'border-outline-variant hover:border-outline focus:border-primary'
            }`}
          />
          <div className="flex items-center justify-between text-body-sm">
            {reasonError ? <p className="text-error">{reasonError}</p> : <span />}
            <span className="text-secondary font-mono">
              {reason.length}/{REFUND_REASON_MAX_LENGTH}
            </span>
          </div>
        </div>

        <div>
          <Button type="submit" variant="primary">
            {REFUNDS_COPY.continueBtn}
          </Button>
        </div>
      </form>

      {/* Modal xác nhận 2 bước */}
      <Modal
        open={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        title={REFUNDS_COPY.modalTitle}
      >
        <div className="flex flex-col gap-space-md">
          <p className="text-body-md text-secondary">{REFUNDS_COPY.modalDescription}</p>

          <div className="p-space-md rounded-lg bg-surface-container-low flex flex-col gap-space-xs text-body-sm">
            <div>
              <span className="text-secondary mr-2">{REFUNDS_COPY.paymentIdLabel}:</span>
              <span className="font-mono font-medium text-on-surface">{normalizePaymentId(paymentId)}</span>
            </div>
            <div>
              <span className="text-secondary mr-2">{REFUNDS_COPY.reasonLabel}:</span>
              <span className="text-on-surface">{reason.trim()}</span>
            </div>
          </div>

          <label className="flex items-center gap-space-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isConfirmed}
              onChange={(e) => setIsConfirmed(e.target.checked)}
              className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
            />
            <span className="text-body-md font-medium text-on-surface">{REFUNDS_COPY.confirmCheckbox}</span>
          </label>

          <div className="flex items-center justify-end gap-space-sm pt-space-sm">
            <Button
              variant="ghost"
              onClick={() => setIsConfirmModalOpen(false)}
              disabled={refundMutation.isPending}
            >
              {REFUNDS_COPY.cancelBtn}
            </Button>
            <Button
              variant="danger"
              disabled={!isConfirmed || refundMutation.isPending}
              loading={refundMutation.isPending}
              onClick={() => void handleConfirmSubmit()}
            >
              {REFUNDS_COPY.confirmBtn}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
