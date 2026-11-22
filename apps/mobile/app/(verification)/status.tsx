import { SESSION_COPY } from '../../src/features/session/copy.js';
import { PlaceholderScreen } from '../../src/features/session/placeholder-screen.js';

export default function VerificationStatusRoute() {
  return (
    <PlaceholderScreen
      title={SESSION_COPY.screens.verificationStatus.title}
      taskId={SESSION_COPY.screens.verificationStatus.taskId}
    />
  );
}
