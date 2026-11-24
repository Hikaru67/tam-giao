import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { isApiError } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import { VOUCHER_QR_TOKEN_MAX_LENGTH } from '@tamgiao/contracts/billing';
import { Button, TextField, Badge, Card } from '@tamgiao/ui-web';
import { SCAN_COPY } from '../auth/copy';
import { InactivePartnerScreen } from '../auth/inactive-partner-screen';
import { partnerMeQueryOptions } from '../auth/partner-auth-api';
import { usePartnerLogout } from '../auth/use-partner-auth';
import { ResultPanel } from './result-panel';
import { redeemOutcome } from './redeem-result';
import { useQrCamera } from './use-qr-camera';
import { redeemVoucher } from './voucher-api';

export function ScanPage() {
  const client = useApiClient();
  const logoutMutation = usePartnerLogout();
  const meQuery = useQuery(partnerMeQueryOptions(client));

  const [manualMode, setManualMode] = useState(false);
  const [manualInputText, setManualInputText] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const [currentToken, setCurrentToken] = useState<string | null>(null);
  const [hadPriorNetworkError, setHadPriorNetworkError] = useState(false);

  const redeemMutation = useMutation({
    mutationFn: (token: string) => redeemVoucher(client, { token }),
    gcTime: 0,
    onError: (error) => {
      const outcome = redeemOutcome(error);
      if (outcome === 'network') {
        setHadPriorNetworkError(true);
      }
    },
  });

  const isScanning =
    !manualMode && !redeemMutation.data && !redeemMutation.error && !redeemMutation.isPending;

  function handleDecode(decodedToken: string) {
    if (!decodedToken) return;
    setCurrentToken(decodedToken);
    setHadPriorNetworkError(false);
    redeemMutation.mutate(decodedToken);
  }

  const {
    videoRef,
    status: cameraStatus,
    retry: retryCamera,
  } = useQrCamera({
    enabled: isScanning,
    onDecode: handleDecode,
  });

  const shouldAutoShowManualForm = cameraStatus === 'denied' || cameraStatus === 'unavailable';
  const isManual = manualMode || shouldAutoShowManualForm;

  function handleManualSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const token = manualInputText.trim();
    if (!token) {
      setManualError(SCAN_COPY.manualInput.emptyError);
      return;
    }
    setManualError(null);
    // Gửi từ form tự hiện (camera lỗi): giữ form trong lúc chờ kết quả.
    setManualMode(true);
    setCurrentToken(token);
    setHadPriorNetworkError(false);
    redeemMutation.mutate(token);
  }

  function handleNextScan() {
    setCurrentToken(null);
    setHadPriorNetworkError(false);
    setManualInputText('');
    setManualError(null);
    setManualMode(false);
    redeemMutation.reset();
  }

  function handleRetry() {
    if (currentToken) {
      redeemMutation.mutate(currentToken);
    }
  }

  const me = meQuery.data;
  const isPartnerInactive =
    (isApiError(meQuery.error) && meQuery.error.code === 'PARTNER_INACTIVE') ||
    (isApiError(redeemMutation.error) && redeemMutation.error.code === 'PARTNER_INACTIVE');

  if (isPartnerInactive) return <InactivePartnerScreen />;

  const hasResult = Boolean(redeemMutation.data || redeemMutation.error);
  const outcome = hasResult ? redeemOutcome(redeemMutation.error) : null;

  return (
    <div className="min-h-screen bg-surface flex flex-col justify-between">
      {/* Result Panel */}
      {outcome ? (
        <ResultPanel
          outcome={outcome}
          valueVnd={redeemMutation.data?.valueVnd ?? null}
          hadPriorNetworkError={hadPriorNetworkError}
          onNextScan={handleNextScan}
          onRetry={handleRetry}
          isRetrying={redeemMutation.isPending}
        />
      ) : null}

      {/* Header */}
      <header className="w-full bg-surface-container-lowest border-b border-surface-container-high relative z-20">
        <div className="max-w-md mx-auto px-gutter h-16 flex items-center justify-between">
          <div className="flex flex-col">
            <div className="flex items-center gap-space-xs">
              <span className="font-bold text-title-md text-on-surface">{me?.partner.name}</span>
              <Badge tone="success">{SCAN_COPY.header.partnerLabel}</Badge>
            </div>
            <span className="text-body-sm text-secondary">
              {SCAN_COPY.header.staffLabel}: {me?.staff.name}
            </span>
          </div>

          <Button
            variant="ghost"
            size="md"
            loading={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
          >
            {SCAN_COPY.header.logout}
          </Button>
        </div>
      </header>

      {/* Main scanning view */}
      <main className="flex-1 max-w-md w-full mx-auto p-gutter flex flex-col justify-center">
        {isManual ? (
          <Card className="p-space-lg flex flex-col gap-space-md">
            <div>
              <h2 className="text-headline-sm font-bold text-on-surface">{SCAN_COPY.manualInput.title}</h2>
              <p className="text-body-sm text-secondary mt-space-xs">{SCAN_COPY.manualInput.description}</p>
            </div>

            {shouldAutoShowManualForm ? (
              <div
                role="alert"
                className="p-space-md rounded-xl bg-surface-container-low text-secondary text-body-sm"
              >
                {cameraStatus === 'denied' ? SCAN_COPY.scanner.denied : SCAN_COPY.scanner.unavailable}
              </div>
            ) : null}

            <form noValidate onSubmit={handleManualSubmit} className="flex flex-col gap-space-md">
              <TextField
                id="manual-voucher-token"
                label={SCAN_COPY.manualInput.tokenLabel}
                placeholder={SCAN_COPY.manualInput.tokenPlaceholder}
                maxLength={VOUCHER_QR_TOKEN_MAX_LENGTH}
                value={manualInputText}
                onChange={(e) => {
                  setManualInputText(e.target.value);
                  if (manualError) setManualError(null);
                }}
                {...(manualError ? { error: manualError } : {})}
              />

              <Button type="submit" variant="primary" size="lg" fullWidth loading={redeemMutation.isPending}>
                {redeemMutation.isPending ? SCAN_COPY.manualInput.submitting : SCAN_COPY.manualInput.submit}
              </Button>

              {!shouldAutoShowManualForm ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  fullWidth
                  onClick={() => setManualMode(false)}
                >
                  {SCAN_COPY.manualInput.cancel}
                </Button>
              ) : (
                <Button type="button" variant="ghost" size="md" fullWidth onClick={retryCamera}>
                  {SCAN_COPY.scanner.retryCamera}
                </Button>
              )}
            </form>
          </Card>
        ) : (
          <div className="flex flex-col gap-space-lg">
            {/* Viewfinder Card */}
            <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-on-surface flex items-center justify-center shadow-lg">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="absolute inset-0 w-full h-full object-cover"
              />

              {/* Viewfinder Target Border */}
              <div className="relative z-10 w-4/5 h-4/5 border-2 border-primary-fixed rounded-xl pointer-events-none flex items-center justify-center">
                <div className="absolute inset-0 border border-on-primary-container opacity-40 rounded-xl" />
              </div>

              {cameraStatus === 'starting' ? (
                <div className="absolute inset-0 z-20 bg-on-surface/70 flex flex-col items-center justify-center text-surface gap-space-sm p-space-md text-center">
                  <span className="inline-block h-8 w-8 animate-spin rounded-full border-3 border-current border-t-transparent" />
                  <span className="text-body-md font-medium">{SCAN_COPY.scanner.starting}</span>
                </div>
              ) : null}

              {cameraStatus === 'error' ? (
                <div className="absolute inset-0 z-20 bg-on-surface/90 flex flex-col items-center justify-center text-surface gap-space-md p-space-md text-center">
                  <p className="text-body-md text-error-container">{SCAN_COPY.scanner.error}</p>
                  <Button variant="secondary" size="md" onClick={retryCamera}>
                    {SCAN_COPY.scanner.retryCamera}
                  </Button>
                </div>
              ) : null}

              {redeemMutation.isPending ? (
                <div className="absolute inset-0 z-30 bg-on-surface/80 flex flex-col items-center justify-center text-surface gap-space-sm p-space-md text-center">
                  <span className="inline-block h-10 w-10 animate-spin rounded-full border-4 border-current border-t-transparent" />
                  <span className="text-title-md font-semibold">{SCAN_COPY.manualInput.submitting}</span>
                </div>
              ) : null}
            </div>

            <div className="text-center flex flex-col items-center gap-space-xs">
              <h1 className="text-headline-sm font-bold text-on-surface">{SCAN_COPY.scanner.title}</h1>
              <p className="text-body-sm text-secondary">{SCAN_COPY.scanner.instruction}</p>
            </div>

            <div className="flex flex-col items-center gap-space-xs pt-space-xs">
              <span className="text-body-sm text-secondary">{SCAN_COPY.scanner.manualInputPrompt}</span>
              <Button variant="ghost" size="md" onClick={() => setManualMode(true)}>
                {SCAN_COPY.scanner.openManualInput}
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
