import { DatesScreen, renderDateActions } from '../../../src/features/dates/index.js';

export default function DateDetailsRoute() {
  return <DatesScreen renderActions={renderDateActions} />;
}
