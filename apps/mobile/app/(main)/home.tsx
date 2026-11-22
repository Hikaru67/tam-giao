import { SESSION_COPY } from '../../src/features/session/copy.js';
import { PlaceholderScreen } from '../../src/features/session/placeholder-screen.js';

export default function HomeRoute() {
  return (
    <PlaceholderScreen title={SESSION_COPY.screens.home.title} taskId={SESSION_COPY.screens.home.taskId} />
  );
}
