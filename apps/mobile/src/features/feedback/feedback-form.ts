import type {
  FEEDBACK_DECISION_NAMES,
  FEEDBACK_FEELING_NAMES,
  FEEDBACK_PROFILE_MATCH_NAMES,
  FEEDBACK_STOP_REASON_NAMES,
} from '@tamgiao/contracts/dating';
import { FEEDBACK_NOTE_MAX_LENGTH, type SubmitFeedbackBody } from '@tamgiao/contracts/dating';

export type FeedbackProfileMatch = (typeof FEEDBACK_PROFILE_MATCH_NAMES)[number];
export type FeedbackFeeling = (typeof FEEDBACK_FEELING_NAMES)[number];
export type FeedbackDecision = (typeof FEEDBACK_DECISION_NAMES)[number];
export type FeedbackStopReason = (typeof FEEDBACK_STOP_REASON_NAMES)[number];

export interface FeedbackDraft {
  readonly rating: number | null;
  readonly profileMatch: FeedbackProfileMatch | null;
  readonly feeling: FeedbackFeeling | null;
  readonly decision: FeedbackDecision | null;
  readonly stopReasons: readonly FeedbackStopReason[];
  readonly stopNote: string;
}

export const emptyDraft: FeedbackDraft = {
  rating: null,
  profileMatch: null,
  feeling: null,
  decision: null,
  stopReasons: [],
  stopNote: '',
};

export function noteLength(text: string): number {
  return [...text.trim()].length;
}

export function isNoteTooLong(text: string): boolean {
  return noteLength(text) > FEEDBACK_NOTE_MAX_LENGTH;
}

export function isDraftComplete(draft: FeedbackDraft): boolean {
  if (
    draft.rating === null ||
    draft.profileMatch === null ||
    draft.feeling === null ||
    draft.decision === null
  ) {
    return false;
  }
  if (draft.decision === 'B_STOP' && isNoteTooLong(draft.stopNote)) {
    return false;
  }
  return true;
}

export function toSubmitBody(draft: FeedbackDraft): SubmitFeedbackBody {
  if (
    draft.rating === null ||
    draft.profileMatch === null ||
    draft.feeling === null ||
    draft.decision === null
  ) {
    throw new Error('FeedbackDraft is incomplete');
  }

  // AC1: A_COMMIT → stopReasons [] và stopNote null BẤT KỂ draft còn giữ gì
  if (draft.decision === 'A_COMMIT') {
    return {
      rating: draft.rating,
      profileMatch: draft.profileMatch,
      feeling: draft.feeling,
      decision: 'A_COMMIT',
      stopReasons: [],
      stopNote: null,
    };
  }

  if (isNoteTooLong(draft.stopNote)) {
    throw new Error('FeedbackDraft stopNote is too long');
  }

  const trimmed = draft.stopNote.trim();
  const stopNote = trimmed.length === 0 ? null : trimmed;

  return {
    rating: draft.rating,
    profileMatch: draft.profileMatch,
    feeling: draft.feeling,
    decision: 'B_STOP',
    stopReasons: [...draft.stopReasons],
    stopNote,
  };
}
