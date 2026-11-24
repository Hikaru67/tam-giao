import { useState, useMemo } from 'react';
import { isApiError, messageFor } from '@tamgiao/api-client';
import { useApiClient } from '@tamgiao/api-client/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { VOUCHER_STATUS_VALUES, type ReconciliationReportDto } from '@tamgiao/contracts/billing';
import { Badge, Button, Card, EmptyState, ErrorState } from '@tamgiao/ui-web';
import { formatDateTime } from '../kyc/format';
import { RECONCILIATION_COPY } from './copy';
import { formatReportDateString, formatVndBigInt } from './money';
import { reconciliationInfiniteQueryOptions, type ReconciliationStatusValue } from './operations-api';

export function ReconciliationPanel() {
  const client = useApiClient();
  const [selectedStatus, setSelectedStatus] = useState<ReconciliationStatusValue | 'ALL'>('ALL');

  const statusParam = selectedStatus === 'ALL' ? undefined : selectedStatus;

  const { data, isLoading, isError, error, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery(reconciliationInfiniteQueryOptions(client, statusParam));

  // Khử trùng theo id khi nối các trang
  const reports = useMemo(() => {
    if (!data?.pages) return [];
    const seen = new Set<string>();
    const result: ReconciliationReportDto[] = [];
    for (const page of data.pages) {
      for (const item of page.items) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          result.push(item);
        }
      }
    }
    return result;
  }, [data]);

  return (
    <div className="flex flex-col gap-space-lg">
      {/* Bộ lọc trạng thái */}
      <Card className="flex flex-wrap items-center gap-space-md">
        <span className="text-label-md font-medium text-on-surface">{RECONCILIATION_COPY.filterLabel}:</span>
        <div className="flex items-center gap-space-xs">
          <Button
            size="md"
            variant={selectedStatus === 'ALL' ? 'primary' : 'ghost'}
            onClick={() => setSelectedStatus('ALL')}
          >
            {RECONCILIATION_COPY.filterAll}
          </Button>
          <Button
            size="md"
            variant={selectedStatus === 'MATCHED' ? 'primary' : 'ghost'}
            onClick={() => setSelectedStatus('MATCHED')}
          >
            {RECONCILIATION_COPY.filterMatched}
          </Button>
          <Button
            size="md"
            variant={selectedStatus === 'MISMATCH' ? 'primary' : 'ghost'}
            onClick={() => setSelectedStatus('MISMATCH')}
          >
            {RECONCILIATION_COPY.filterMismatch}
          </Button>
        </div>
      </Card>

      {/* Danh sách báo cáo */}
      {isError && !data ? (
        <Card>
          <ErrorState
            title={messageFor(isApiError(error) ? error : { code: 'UNKNOWN' }).title}
            onRetry={() => void refetch()}
          />
        </Card>
      ) : isLoading && reports.length === 0 ? (
        <Card className="flex justify-center items-center py-space-xl">
          <span
            className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
            aria-hidden="true"
          />
        </Card>
      ) : reports.length === 0 ? (
        <Card>
          <EmptyState title={RECONCILIATION_COPY.empty} description={RECONCILIATION_COPY.emptyDescription} />
        </Card>
      ) : (
        <div className="flex flex-col gap-space-lg">
          {reports.map((report) => {
            const isMatched = report.status === 'MATCHED';
            return (
              <Card
                key={report.id}
                className="flex flex-col gap-space-md border border-surface-container-high"
              >
                {/* Header báo cáo */}
                <div className="flex flex-wrap items-center justify-between gap-space-sm border-b border-surface-container-high pb-space-sm">
                  <div className="flex items-center gap-space-md">
                    <span className="text-title-md font-bold text-on-surface">
                      {formatReportDateString(report.reportDate)}
                    </span>
                    <Badge tone={isMatched ? 'success' : 'danger'}>
                      {RECONCILIATION_COPY.statusLabels[report.status]}
                    </Badge>
                  </div>
                  <div className="text-body-sm text-secondary">
                    <span>{RECONCILIATION_COPY.tableRunAt}: </span>
                    <span className="text-on-surface">{formatDateTime(report.runAt)}</span>
                  </div>
                </div>

                {/* Tổng số tiền */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-space-md p-space-md rounded-lg bg-surface-container-low text-body-sm">
                  <div>
                    <span className="text-secondary block">{RECONCILIATION_COPY.tableLedgerCharge}</span>
                    <span className="font-semibold text-on-surface text-body-md">
                      {formatVndBigInt(report.totals.ledgerChargeTotalVnd)}
                    </span>
                  </div>
                  <div>
                    <span className="text-secondary block">{RECONCILIATION_COPY.tableLedgerRefund}</span>
                    <span className="font-semibold text-on-surface text-body-md">
                      {formatVndBigInt(report.totals.ledgerRefundTotalVnd)}
                    </span>
                  </div>
                  <div>
                    <span className="text-secondary block">{RECONCILIATION_COPY.tableHeldPayment}</span>
                    <span className="font-semibold text-on-surface text-body-md">
                      {formatVndBigInt(report.totals.heldPaymentTotalVnd)}
                    </span>
                  </div>
                  <div>
                    <span className="text-secondary block">{RECONCILIATION_COPY.tableHeldCount}</span>
                    <span className="font-semibold text-on-surface text-body-md">
                      {report.totals.heldPaymentCount}
                    </span>
                  </div>
                </div>

                {/* Số lượng voucher theo trạng thái */}
                <div>
                  <span className="text-label-md font-medium text-secondary block mb-space-xs">
                    {RECONCILIATION_COPY.tableVouchers}
                  </span>
                  <div className="flex flex-wrap gap-space-xs">
                    {VOUCHER_STATUS_VALUES.map((vKey) => (
                      <Badge key={vKey} tone="neutral">
                        {RECONCILIATION_COPY.voucherStatusLabels[vKey]}:{' '}
                        {report.totals.vouchersByStatus[vKey]}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Chi tiết lệch */}
                {report.mismatches.length > 0 ? (
                  <div className="flex flex-col gap-space-xs mt-space-xs">
                    <span className="text-label-md font-bold text-error block">
                      {RECONCILIATION_COPY.tableMismatches}
                    </span>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-body-sm border border-surface-container-high rounded-md">
                        <thead className="bg-surface-container-high text-secondary">
                          <tr>
                            <th className="p-space-sm">{RECONCILIATION_COPY.mismatchCheck}</th>
                            <th className="p-space-sm">{RECONCILIATION_COPY.mismatchLedger}</th>
                            <th className="p-space-sm">{RECONCILIATION_COPY.mismatchState}</th>
                            <th className="p-space-sm">{RECONCILIATION_COPY.mismatchDifference}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-surface-container-high">
                          {report.mismatches.map((m) => {
                            const isMoney = m.check === 'MONEY_BALANCE';
                            const displayLedger = isMoney ? formatVndBigInt(m.ledger) : m.ledger;
                            const displayState = isMoney ? formatVndBigInt(m.state) : m.state;
                            const displayDiff = isMoney ? formatVndBigInt(m.difference) : m.difference;

                            return (
                              <tr key={m.check} className="hover:bg-surface-container-low">
                                <td className="p-space-sm font-medium">
                                  {RECONCILIATION_COPY.checkLabels[m.check]}
                                </td>
                                <td className="p-space-sm font-mono">{displayLedger}</td>
                                <td className="p-space-sm font-mono">{displayState}</td>
                                <td className="p-space-sm font-mono font-semibold text-error">
                                  {displayDiff}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </Card>
            );
          })}

          {hasNextPage ? (
            <div className="flex justify-center pt-space-sm">
              <Button variant="secondary" loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
                {RECONCILIATION_COPY.loadMore}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
