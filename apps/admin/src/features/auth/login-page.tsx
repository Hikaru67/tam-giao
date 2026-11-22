import { useState, type FormEvent } from 'react';
import { useRouter, useSearch } from '@tanstack/react-router';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { Button, TextField, Badge } from '@tamgiao/ui-web';
import { LOGIN_COPY } from './copy';
import { safeRedirectTarget } from './login-search';
import { useAdminLogin } from './use-admin-auth';

type FormField = 'email' | 'password' | 'totp';
type FormErrors = Partial<Record<FormField, string>>;

function withoutError(errors: FormErrors, field: FormField): FormErrors {
  const next = { ...errors };
  delete next[field];
  return next;
}

/** Prop `error` của TextField chỉ truyền khi có lỗi (exactOptionalPropertyTypes). */
function errorProp(message: string | undefined): { error?: string } {
  return message ? { error: message } : {};
}

export function LoginPage() {
  const router = useRouter();
  const search = useSearch({ from: '/login' });
  const loginMutation = useAdminLogin();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [rememberDevice, setRememberDevice] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const newErrors: FormErrors = {};
    if (!email.trim()) {
      newErrors.email = LOGIN_COPY.errors.emailRequired;
    }
    if (!password) {
      newErrors.password = LOGIN_COPY.errors.passwordRequired;
    }
    if (!/^\d{6}$/.test(totp)) {
      newErrors.totp = LOGIN_COPY.errors.totpInvalid;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    loginMutation.mutate(
      {
        email: email.trim(),
        password,
        totpCode: totp,
        ...(rememberDevice ? { rememberDevice: true } : {}),
      },
      {
        onSuccess: () => {
          void router.history.push(safeRedirectTarget(search));
        },
        onError: () => {
          setTotp('');
        },
      },
    );
  }

  const apiError = loginMutation.error;
  const errorInfo = apiError ? messageFor(isApiError(apiError) ? apiError : { code: 'UNKNOWN' }) : null;

  return (
    <div className="min-h-screen bg-surface flex flex-col justify-between">
      {/* Header */}
      <header className="w-full bg-surface-container-lowest border-b border-surface-container-high relative z-20">
        <div className="w-full px-gutter-desktop h-16 flex items-center justify-between">
          <div className="flex items-center gap-space-md">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-on-primary shadow-sm">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-space-xs">
                <span className="font-bold text-headline-sm text-on-surface">{LOGIN_COPY.brandName}</span>
                <Badge tone="primary">{LOGIN_COPY.adminBadge}</Badge>
              </div>
              <span className="text-body-sm text-secondary">{LOGIN_COPY.headerSubtitle}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 flex items-center justify-center py-space-xl px-gutter">
        <div className="w-full max-w-5xl rounded-xl bg-surface-container-lowest border border-surface-container-high shadow-md overflow-hidden grid grid-cols-1 lg:grid-cols-2">
          {/* Left panel (brand) */}
          <div className="hidden lg:flex lg:flex-col justify-between bg-surface-container-low p-space-xl">
            <div className="flex flex-col gap-space-md">
              <span className="text-label-sm font-semibold tracking-wider uppercase text-primary">
                {LOGIN_COPY.brandEyebrow}
              </span>
              <div>
                <h1 className="text-headline-lg font-bold text-on-surface">{LOGIN_COPY.brandName}</h1>
                <p className="text-title-md text-primary font-medium mt-space-xs">
                  {LOGIN_COPY.brandTagline}
                </p>
              </div>
              <p className="text-body-md text-secondary">{LOGIN_COPY.brandDescription}</p>

              <div className="flex flex-col gap-space-md mt-space-md">
                {LOGIN_COPY.features.map((f) => (
                  <div
                    key={f.title}
                    className="p-space-md rounded-xl bg-surface-container-lowest shadow-sm flex flex-col gap-space-xs"
                  >
                    <span className="text-label-md font-semibold text-on-surface">{f.title}</span>
                    <span className="text-body-sm text-secondary">{f.description}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right panel (form) */}
          <div className="p-space-xl flex flex-col justify-between">
            <div className="max-w-md w-full mx-auto">
              <div className="mb-space-lg">
                <span className="text-label-sm font-semibold tracking-wider uppercase text-primary">
                  {LOGIN_COPY.formEyebrow}
                </span>
                <h2 className="text-headline-md font-bold text-on-surface mt-space-xs">{LOGIN_COPY.title}</h2>
                <p className="text-body-md text-secondary mt-space-xs">{LOGIN_COPY.description}</p>
              </div>

              {errorInfo ? (
                <div
                  role="alert"
                  className="bg-error-container text-on-error-container rounded-lg p-space-md mb-space-md flex flex-col gap-space-xs"
                >
                  <span className="font-semibold text-body-md">{errorInfo.title}</span>
                  {errorInfo.action ? <span className="text-body-sm">{errorInfo.action}</span> : null}
                </div>
              ) : null}

              <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-space-md">
                <TextField
                  id="admin-login-email"
                  type="email"
                  autoComplete="username"
                  label={LOGIN_COPY.emailLabel}
                  placeholder={LOGIN_COPY.emailPlaceholder}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errors.email) setErrors((prev) => withoutError(prev, 'email'));
                  }}
                  {...errorProp(errors.email)}
                />

                <div className="relative">
                  <TextField
                    id="admin-login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    label={LOGIN_COPY.passwordLabel}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errors.password) setErrors((prev) => withoutError(prev, 'password'));
                    }}
                    {...errorProp(errors.password)}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? LOGIN_COPY.hidePassword : LOGIN_COPY.showPassword}
                    onClick={() => setShowPassword((p) => !p)}
                    className="absolute right-3 top-9 text-secondary hover:text-on-surface p-1 cursor-pointer"
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      {showPassword ? (
                        <>
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </>
                      ) : (
                        <>
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </>
                      )}
                    </svg>
                  </button>
                </div>

                <TextField
                  id="admin-login-totp"
                  label={LOGIN_COPY.totpLabel}
                  hint={LOGIN_COPY.totpHint}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={totp}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setTotp(digits);
                    if (errors.totp) setErrors((prev) => withoutError(prev, 'totp'));
                  }}
                  {...errorProp(errors.totp)}
                />

                <div className="flex items-center gap-space-xs mt-space-xs">
                  <input
                    type="checkbox"
                    id="admin-remember-device"
                    checked={rememberDevice}
                    onChange={(e) => setRememberDevice(e.target.checked)}
                    className="accent-primary w-4 h-4 rounded cursor-pointer"
                  />
                  <label
                    htmlFor="admin-remember-device"
                    className="text-body-md text-on-surface cursor-pointer select-none"
                  >
                    {LOGIN_COPY.rememberDevice}
                  </label>
                </div>

                <Button type="submit" variant="primary" size="lg" fullWidth loading={loginMutation.isPending}>
                  {LOGIN_COPY.submit}
                </Button>

                <div className="p-space-md rounded-xl bg-surface-container-low text-secondary text-body-sm space-y-space-xs mt-space-xs">
                  <div className="font-semibold text-label-md text-on-surface">{LOGIN_COPY.noticeTitle}</div>
                  <p>{LOGIN_COPY.noticeBody}</p>
                </div>
              </form>
            </div>

            <p className="text-center text-body-sm text-secondary mt-space-lg">{LOGIN_COPY.footer}</p>
          </div>
        </div>
      </main>
    </div>
  );
}
