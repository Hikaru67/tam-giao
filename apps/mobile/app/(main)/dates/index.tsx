import { DatesScreen, renderDateActions } from '../../../src/features/dates/index.js';

export default function DatesIndexRoute() {
  return <DatesScreen renderActions={renderDateActions} />;
}
