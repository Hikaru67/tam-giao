import { SESSION_COPY } from '../../src/features/session/copy.js';
import { PlaceholderScreen } from '../../src/features/session/placeholder-screen.js';

export default function PreferencesRoute() {
  return (
    <PlaceholderScreen
      title={SESSION_COPY.screens.preferences.title}
      taskId={SESSION_COPY.screens.preferences.taskId}
    />
  );
}
