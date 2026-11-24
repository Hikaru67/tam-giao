import { useState, type FormEvent } from 'react';
import { useRouter } from '@tanstack/react-router';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { Button, TextField, Badge, Card } from '@tamgiao/ui-web';
import { LOGIN_COPY } from './copy';
import { getOrCreateDeviceId } from './device-id';
import {
  getRememberedStaffId,
  setRememberedStaffId,
  clearRememberedStaffId,
  isValidStaffId,
  normalizeStaffId,
} from './staff-id-store';
import { usePartnerLogin } from './use-partner-auth';

type FormField = 'staffId' | 'pin';
type FormErrors = Partial<Record<FormField, string>>;

function withoutError(errors: FormErrors, field: FormField): FormErrors {
  const next = { ...errors };
  delete next[field];
  return next;
}

function errorProp(message: string | undefined): { error?: string } {
  return message ? { error: message } : {};
}

export function LoginPage() {
  const router = useRouter();
  const loginMutation = usePartnerLogin();

  const [rememberedStaffId, setRememberedStaffIdState] = useState<string | null>(() =>
    getRememberedStaffId(),
  );
  const [staffId, setStaffId] = useState<string>(() => rememberedStaffId ?? '');
  const [pin, setPin] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});

  function handleChangeStaffId() {
    clearRememberedStaffId();
    setRememberedStaffIdState(null);
    setStaffId('');
    setPin('');
    setErrors({});
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const currentStaffId = rememberedStaffId ?? staffId;
    const normalizedId = normalizeStaffId(currentStaffId);
    const newErrors: FormErrors = {};

    if (!normalizedId) {
      newErrors.staffId = LOGIN_COPY.errors.staffIdRequired;
    } else if (!isValidStaffId(normalizedId)) {
      newErrors.staffId = LOGIN_COPY.errors.staffIdInvalid;
    }

    if (!pin) {
      newErrors.pin = LOGIN_COPY.errors.pinRequired;
    } else if (!/^\d{6}$/.test(pin)) {
      newErrors.pin = LOGIN_COPY.errors.pinInvalid;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    const deviceId = getOrCreateDeviceId();

    loginMutation.mutate(
      {
        staffId: normalizedId,
        pin,
        deviceId,
      },
      {
        onSuccess: () => {
          setRememberedStaffId(normalizedId);
          void router.navigate({ to: '/' });
        },
        onError: () => {
          setPin('');
        },
      },
    );
  }

  const apiError = loginMutation.error;
  const isLocked = isApiError(apiError) && apiError.code === 'PARTNER_STAFF_LOCKED';
  const retrySeconds =
    isLocked && apiError.meta && typeof apiError.meta['retryAfterSeconds'] === 'number'
      ? (apiError.meta['retryAfterSeconds'] as number)
      : null;
  const retryMinutes = retrySeconds ? Math.ceil(retrySeconds / 60) : null;

  const errorInfo = apiError ? messageFor(isApiError(apiError) ? apiError : { code: 'UNKNOWN' }) : null;

  return (
    <div className="min-h-screen bg-surface flex flex-col justify-between">
      {/* Header */}
      <header className="w-full bg-surface-container-lowest border-b border-surface-container-high relative z-20">
        <div className="max-w-md mx-auto px-gutter h-16 flex items-center justify-between">
          <div className="flex items-center gap-space-md">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-on-primary shadow-sm">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-space-xs">
                <span className="font-bold text-headline-sm text-on-surface">{LOGIN_COPY.brandName}</span>
                <Badge tone="primary">{LOGIN_COPY.badge}</Badge>
              </div>
              <span className="text-body-sm text-secondary">{LOGIN_COPY.headerSubtitle}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Form */}
      <main className="flex-1 flex items-center justify-center py-space-xl px-gutter">
        <div className="w-full max-w-md">
          <Card className="p-space-lg">
            <div className="mb-space-lg text-center">
              <h1 className="text-headline-md font-bold text-on-surface">{LOGIN_COPY.title}</h1>
              <p className="text-body-md text-secondary mt-space-xs">{LOGIN_COPY.description}</p>
            </div>

            {errorInfo ? (
              <div
                role="alert"
                className="bg-error-container text-on-error-container rounded-lg p-space-md mb-space-md flex flex-col gap-space-xs"
              >
                <span className="font-semibold text-body-md">{errorInfo.title}</span>
                {retryMinutes ? (
                  <span className="text-body-sm">{LOGIN_COPY.lockedNotice(retryMinutes)}</span>
                ) : errorInfo.action ? (
                  <span className="text-body-sm">{errorInfo.action}</span>
                ) : null}
              </div>
            ) : null}

            <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-space-md">
              {rememberedStaffId ? (
                <div className="p-space-md rounded-xl bg-surface-container-low border border-surface-container-high flex flex-col gap-space-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-label-sm font-semibold text-primary">
                      {LOGIN_COPY.rememberedStaffNotice}
                    </span>
                    <button
                      type="button"
                      onClick={handleChangeStaffId}
                      className="text-label-sm font-medium text-primary hover:underline cursor-pointer"
                    >
                      {LOGIN_COPY.changeStaffId}
                    </button>
                  </div>
                  <span className="text-body-md font-mono text-on-surface break-all select-all">
                    {rememberedStaffId}
                  </span>
                </div>
              ) : (
                <TextField
                  id="partner-staff-id"
                  type="text"
                  autoComplete="username"
                  label={LOGIN_COPY.staffIdLabel}
                  placeholder={LOGIN_COPY.staffIdPlaceholder}
                  value={staffId}
                  onChange={(e) => {
                    setStaffId(e.target.value);
                    if (errors.staffId) setErrors((prev) => withoutError(prev, 'staffId'));
                  }}
                  {...errorProp(errors.staffId)}
                />
              )}

              <TextField
                id="partner-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                label={LOGIN_COPY.pinLabel}
                hint={LOGIN_COPY.pinHint}
                value={pin}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setPin(digits);
                  if (errors.pin) setErrors((prev) => withoutError(prev, 'pin'));
                }}
                {...errorProp(errors.pin)}
              />

              <Button type="submit" variant="primary" size="lg" fullWidth loading={loginMutation.isPending}>
                {loginMutation.isPending ? LOGIN_COPY.submitting : LOGIN_COPY.submit}
              </Button>
            </form>
          </Card>

          <p className="text-center text-body-sm text-secondary mt-space-lg">{LOGIN_COPY.footerNotice}</p>
        </div>
      </main>
    </div>
  );
}
