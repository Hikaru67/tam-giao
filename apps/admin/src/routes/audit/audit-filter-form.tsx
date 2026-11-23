import { useState, type FormEvent } from 'react';
import { Button, Card, TextField } from '@tamgiao/ui-web';
import {
  isoToDateTimeLocal,
  dateTimeLocalToIso,
  type AuditFilterField,
  type AuditSearch,
} from './audit-search';
import { AUDIT_COPY } from './copy';

export interface AuditFilterFormProps {
  search: AuditSearch;
  fieldErrors: Partial<Record<AuditFilterField, string>>;
  onApply: (next: AuditSearch) => void;
  onReset: () => void;
}

export function AuditFilterForm({ search, fieldErrors, onApply, onReset }: AuditFilterFormProps) {
  const [actorType, setActorType] = useState(search.actorType ?? '');
  const [actorId, setActorId] = useState(search.actorId ?? '');
  const [targetType, setTargetType] = useState(search.targetType ?? '');
  const [targetId, setTargetId] = useState(search.targetId ?? '');
  const [fromState, setFromState] = useState(() => ({
    local: isoToDateTimeLocal(search.from),
    raw: search.from,
  }));
  const [toState, setToState] = useState(() => ({
    local: isoToDateTimeLocal(search.to),
    raw: search.to,
  }));

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next: AuditSearch = {};

    const trimmedActorType = actorType.trim();
    if (trimmedActorType !== '') {
      next.actorType = trimmedActorType;
    }

    const trimmedActorId = actorId.trim();
    if (trimmedActorId !== '') {
      next.actorId = trimmedActorId;
    }

    const trimmedTargetType = targetType.trim();
    if (trimmedTargetType !== '') {
      next.targetType = trimmedTargetType;
    }

    const trimmedTargetId = targetId.trim();
    if (trimmedTargetId !== '') {
      next.targetId = trimmedTargetId;
    }

    const fromIso = fromState.raw ?? dateTimeLocalToIso(fromState.local);
    if (fromIso !== undefined && fromIso.trim() !== '') {
      next.from = fromIso.trim();
    }

    const toIso = toState.raw ?? dateTimeLocalToIso(toState.local);
    if (toIso !== undefined && toIso.trim() !== '') {
      next.to = toIso.trim();
    }

    onApply(next);
  }

  const actorTypeId = 'audit-filter-actor-type';
  const actorTypeErrorId = `${actorTypeId}-error`;
  const hasActorTypeError = Boolean(fieldErrors.actorType);

  return (
    <Card>
      <form
        aria-label={AUDIT_COPY.filterTitle}
        onSubmit={handleSubmit}
        className="flex flex-col gap-space-md"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md">
          <div className="flex flex-col gap-space-xs w-full">
            <label htmlFor={actorTypeId} className="text-label-md font-medium text-on-surface">
              {AUDIT_COPY.actorType.label}
            </label>
            <select
              id={actorTypeId}
              value={actorType}
              onChange={(e) => setActorType(e.target.value)}
              aria-invalid={hasActorTypeError}
              aria-describedby={hasActorTypeError ? actorTypeErrorId : undefined}
              className={`w-full min-h-[44px] px-space-md py-space-xs rounded-md bg-surface-container-lowest text-on-surface text-body-md border transition-colors outline-none focus:ring-2 focus:ring-primary ${
                hasActorTypeError
                  ? 'border-error focus:border-error'
                  : 'border-outline-variant hover:border-outline focus:border-primary'
              }`}
            >
              <option value="">{AUDIT_COPY.actorType.all}</option>
              <option value="admin">{AUDIT_COPY.actorTypeLabels.admin}</option>
              <option value="user">{AUDIT_COPY.actorTypeLabels.user}</option>
              <option value="system">{AUDIT_COPY.actorTypeLabels.system}</option>
            </select>
            {fieldErrors.actorType ? (
              <p id={actorTypeErrorId} className="text-body-sm text-error">
                {fieldErrors.actorType}
              </p>
            ) : null}
          </div>

          <TextField
            id="audit-filter-actor-id"
            label={AUDIT_COPY.actorId.label}
            placeholder={AUDIT_COPY.actorId.placeholder}
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            {...(fieldErrors.actorId ? { error: fieldErrors.actorId } : {})}
          />

          <TextField
            id="audit-filter-target-type"
            label={AUDIT_COPY.targetType.label}
            placeholder={AUDIT_COPY.targetType.placeholder}
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
            {...(fieldErrors.targetType ? { error: fieldErrors.targetType } : {})}
          />

          <TextField
            id="audit-filter-target-id"
            label={AUDIT_COPY.targetId.label}
            placeholder={AUDIT_COPY.targetId.placeholder}
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            {...(fieldErrors.targetId ? { error: fieldErrors.targetId } : {})}
          />

          <TextField
            id="audit-filter-from"
            type="datetime-local"
            label={AUDIT_COPY.from.label}
            value={fromState.local}
            onChange={(e) => setFromState({ local: e.target.value, raw: undefined })}
            {...(fieldErrors.from ? { error: fieldErrors.from } : {})}
          />

          <TextField
            id="audit-filter-to"
            type="datetime-local"
            label={AUDIT_COPY.to.label}
            value={toState.local}
            onChange={(e) => setToState({ local: e.target.value, raw: undefined })}
            {...(fieldErrors.to ? { error: fieldErrors.to } : {})}
          />
        </div>

        <div className="flex items-center gap-space-sm justify-end">
          <Button type="button" variant="ghost" onClick={onReset}>
            {AUDIT_COPY.reset}
          </Button>
          <Button type="submit" variant="primary">
            {AUDIT_COPY.apply}
          </Button>
        </div>
      </form>
    </Card>
  );
}
