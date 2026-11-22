import { Badge, Button } from '@tamgiao/ui-web';

export function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface p-space-md gap-space-sm">
      <h1 className="text-headline-md font-bold text-primary">Tâm Giao — Cổng quản trị</h1>
      <p className="mt-space-xs text-body-md text-secondary">Khung ứng dụng (FE-S1-01)</p>
      <div className="flex items-center gap-space-xs mt-space-sm">
        <Badge tone="primary">Quản trị viên</Badge>
        <Button variant="secondary" size="md">
          Làm mới
        </Button>
      </div>
    </div>
  );
}
