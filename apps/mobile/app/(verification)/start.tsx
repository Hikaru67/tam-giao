import { SESSION_COPY } from '../../src/features/session/copy.js';
import { PlaceholderScreen } from '../../src/features/session/placeholder-screen.js';

export default function VerificationStartRoute() {
  return (
    <PlaceholderScreen
      title={SESSION_COPY.screens.verificationStart.title}
      taskId={SESSION_COPY.screens.verificationStart.taskId}
    />
  );
}
