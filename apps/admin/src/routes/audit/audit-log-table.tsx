import type { AuditLogEntry } from '@tamgiao/contracts/identity';
import { Badge, type BadgeTone } from '@tamgiao/ui-web';
import { AUDIT_COPY } from './copy';

const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'medium',
});

function formatOccurredAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTimeFormatter.format(date);
}

const actorBadgeTone: Record<AuditLogEntry['actor']['type'], BadgeTone> = {
  admin: 'primary',
  user: 'neutral',
  system: 'warning',
};

export function AuditLogTable({ items }: { items: readonly AuditLogEntry[] }) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-surface-container-high bg-surface-container-lowest shadow-sm">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-surface-container-high bg-surface-container-low">
            <th className="px-space-md py-space-sm text-label-md text-secondary font-medium">
              {AUDIT_COPY.columns.occurredAt}
            </th>
            <th className="px-space-md py-space-sm text-label-md text-secondary font-medium">
              {AUDIT_COPY.columns.actor}
            </th>
            <th className="px-space-md py-space-sm text-label-md text-secondary font-medium">
              {AUDIT_COPY.columns.action}
            </th>
            <th className="px-space-md py-space-sm text-label-md text-secondary font-medium">
              {AUDIT_COPY.columns.target}
            </th>
            <th className="px-space-md py-space-sm text-label-md text-secondary font-medium">
              {AUDIT_COPY.columns.ip}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-container-high">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-surface-container-low transition-colors">
              <td className="px-space-md py-space-sm text-body-sm text-secondary whitespace-nowrap">
                {formatOccurredAt(item.occurredAt)}
              </td>
              <td className="px-space-md py-space-sm">
                <div className="flex flex-col gap-space-xs items-start">
                  <Badge tone={actorBadgeTone[item.actor.type]}>
                    {AUDIT_COPY.actorTypeLabels[item.actor.type]}
                  </Badge>
                  {item.actor.id ? (
                    <span className="font-mono text-body-sm text-secondary break-all">{item.actor.id}</span>
                  ) : null}
                </div>
              </td>
              <td className="px-space-md py-space-sm font-mono text-body-sm text-on-surface">
                {item.action}
              </td>
              <td className="px-space-md py-space-sm">
                <div className="flex flex-col gap-space-xs">
                  <span className="text-body-sm font-medium text-on-surface">{item.targetType}</span>
                  <span className="font-mono text-body-sm text-secondary break-all">{item.targetId}</span>
                </div>
              </td>
              <td className="px-space-md py-space-sm text-body-sm text-secondary whitespace-nowrap">
                {item.ip ?? AUDIT_COPY.noIp}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
