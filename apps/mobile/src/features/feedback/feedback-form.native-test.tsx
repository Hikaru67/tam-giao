import { FEEDBACK_NOTE_MAX_LENGTH } from '@tamgiao/contracts/dating';
import {
  emptyDraft,
  isDraftComplete,
  isNoteTooLong,
  noteLength,
  toSubmitBody,
  type FeedbackDraft,
} from './feedback-form.js';

describe('feedback-form (FE-S5-04)', () => {
  describe('noteLength & isNoteTooLong', () => {
    it('counts length after trimming whitespace', () => {
      expect(noteLength('')).toBe(0);
      expect(noteLength('   ')).toBe(0);
      expect(noteLength('  hello  ')).toBe(5);
    });

    it('counts Unicode code points accurately (emojis)', () => {
      // Mỗi emoji là 1 code point dù trong UTF-16 chiếm surrogate pair
      expect(noteLength('😊')).toBe(1);
      expect(noteLength('   🎉✨   ')).toBe(2);
      expect(noteLength('Rất vui 😊')).toBe(9);
    });

    it('identifies if note exceeds FEEDBACK_NOTE_MAX_LENGTH', () => {
      const exactNote = 'a'.repeat(FEEDBACK_NOTE_MAX_LENGTH);
      expect(isNoteTooLong(exactNote)).toBe(false);

      const tooLongNote = 'a'.repeat(FEEDBACK_NOTE_MAX_LENGTH + 1);
      expect(isNoteTooLong(tooLongNote)).toBe(true);

      const emojiTooLong = '🎉'.repeat(FEEDBACK_NOTE_MAX_LENGTH + 1);
      expect(isNoteTooLong(emojiTooLong)).toBe(true);
    });
  });

  describe('emptyDraft', () => {
    it('initializes with null values and empty stopReasons/stopNote', () => {
      expect(emptyDraft).toEqual({
        rating: null,
        profileMatch: null,
        feeling: null,
        decision: null,
        stopReasons: [],
        stopNote: '',
      });
    });
  });

  describe('isDraftComplete', () => {
    it('returns false when any required field is null', () => {
      expect(isDraftComplete(emptyDraft)).toBe(false);

      const partial1: FeedbackDraft = {
        ...emptyDraft,
        rating: 5,
        profileMatch: 'FULL_MATCH',
        feeling: 'DEEP_INTEREST',
        decision: null,
      };
      expect(isDraftComplete(partial1)).toBe(false);

      const partial2: FeedbackDraft = {
        ...emptyDraft,
        rating: null,
        profileMatch: 'FULL_MATCH',
        feeling: 'DEEP_INTEREST',
        decision: 'A_COMMIT',
      };
      expect(isDraftComplete(partial2)).toBe(false);

      const partial3: FeedbackDraft = {
        ...emptyDraft,
        rating: 4,
        profileMatch: null,
        feeling: 'DEEP_INTEREST',
        decision: 'A_COMMIT',
      };
      expect(isDraftComplete(partial3)).toBe(false);

      const partial4: FeedbackDraft = {
        ...emptyDraft,
        rating: 4,
        profileMatch: 'FULL_MATCH',
        feeling: null,
        decision: 'A_COMMIT',
      };
      expect(isDraftComplete(partial4)).toBe(false);
    });

    it('returns true for complete A_COMMIT draft', () => {
      const completeA: FeedbackDraft = {
        rating: 5,
        profileMatch: 'FULL_MATCH',
        feeling: 'DEEP_INTEREST',
        decision: 'A_COMMIT',
        stopReasons: [],
        stopNote: '',
      };
      expect(isDraftComplete(completeA)).toBe(true);
    });

    it('validates B_STOP draft and checks note length', () => {
      const completeB: FeedbackDraft = {
        rating: 3,
        profileMatch: 'MOSTLY_MATCH',
        feeling: 'NOT_A_FIT',
        decision: 'B_STOP',
        stopReasons: ['NO_SPARK'],
        stopNote: 'Cần thêm thời gian',
      };
      expect(isDraftComplete(completeB)).toBe(true);

      const tooLongB: FeedbackDraft = {
        ...completeB,
        stopNote: 'x'.repeat(FEEDBACK_NOTE_MAX_LENGTH + 1),
      };
      expect(isDraftComplete(tooLongB)).toBe(false);
    });
  });

  describe('toSubmitBody', () => {
    it('throws error when draft is incomplete', () => {
      expect(() => toSubmitBody(emptyDraft)).toThrow('FeedbackDraft is incomplete');
    });

    it('AC1: A_COMMIT clears stopReasons to [] and stopNote to null even if draft held values', () => {
      const draftWithPreexistingReasons: FeedbackDraft = {
        rating: 5,
        profileMatch: 'FULL_MATCH',
        feeling: 'DEEP_INTEREST',
        decision: 'A_COMMIT',
        stopReasons: ['LIFESTYLE_DIFFERENCE', 'NO_SPARK'],
        stopNote: 'Đã nhập ghi chú trước khi đổi sang A',
      };

      const body = toSubmitBody(draftWithPreexistingReasons);
      expect(body).toEqual({
        rating: 5,
        profileMatch: 'FULL_MATCH',
        feeling: 'DEEP_INTEREST',
        decision: 'A_COMMIT',
        stopReasons: [],
        stopNote: null,
      });
    });

    it('B_STOP preserves stopReasons and trims stopNote', () => {
      const draftB: FeedbackDraft = {
        rating: 2,
        profileMatch: 'DIFFERENT',
        feeling: 'NOT_A_FIT',
        decision: 'B_STOP',
        stopReasons: ['FINANCE_FAMILY_PLAN_DIFFERENCE'],
        stopNote: '   Khác biệt về kế hoạch tài chính   ',
      };

      const body = toSubmitBody(draftB);
      expect(body).toEqual({
        rating: 2,
        profileMatch: 'DIFFERENT',
        feeling: 'NOT_A_FIT',
        decision: 'B_STOP',
        stopReasons: ['FINANCE_FAMILY_PLAN_DIFFERENCE'],
        stopNote: 'Khác biệt về kế hoạch tài chính',
      });
    });

    it('B_STOP converts empty or whitespace note to null', () => {
      const draftEmptyNote: FeedbackDraft = {
        rating: 3,
        profileMatch: 'MOSTLY_MATCH',
        feeling: 'NEED_MORE_TIME',
        decision: 'B_STOP',
        stopReasons: [],
        stopNote: '     ',
      };

      const body = toSubmitBody(draftEmptyNote);
      expect(body.stopNote).toBeNull();
      expect(body.stopReasons).toEqual([]);
    });

    it('throws error when B_STOP has note exceeding max length', () => {
      const draftTooLong: FeedbackDraft = {
        rating: 1,
        profileMatch: 'DIFFERENT',
        feeling: 'NOT_A_FIT',
        decision: 'B_STOP',
        stopReasons: [],
        stopNote: 'x'.repeat(FEEDBACK_NOTE_MAX_LENGTH + 1),
      };

      expect(() => toSubmitBody(draftTooLong)).toThrow('FeedbackDraft stopNote is too long');
    });
  });
});
