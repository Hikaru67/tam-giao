import {
  PARTNER_NAME_MAX_LENGTH,
  PARTNER_ADDRESS_MAX_LENGTH,
  PARTNER_TAG_MAX_LENGTH,
  PARTNER_TAGS_MAX,
  type AdminPartner,
  type UpdatePartnerBody,
} from '@tamgiao/contracts/billing';
import { isApiError } from '@tamgiao/api-client';
import { PARTNERS_COPY } from './copy';

/** Tách tags từ chuỗi phân cách bởi dấu phẩy hoặc dòng mới, trim và khử trùng */
export function parseTags(raw: string): string[] {
  const parts = raw.split(/[\n,\r]+/);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

export interface PartnerFormValues {
  name: string;
  address: string;
  photoUrl: string;
  tagsText: string;
}

export type PartnerFormField = 'name' | 'address' | 'photoUrl' | 'tags';

/** Bỏ lỗi của một trường khi người dùng sửa lại trường đó. */
export function withoutField<K extends string>(
  errors: Partial<Record<K, string>>,
  field: K,
): Partial<Record<K, string>> {
  const next = { ...errors };
  delete next[field];
  return next;
}

export function validatePartnerForm(values: {
  name: string;
  address: string;
  photoUrl: string;
  tags: string[];
}): Partial<Record<PartnerFormField, string>> {
  const errors: Partial<Record<PartnerFormField, string>> = {};

  const nameTrimmed = values.name.trim();
  if (nameTrimmed.length === 0) {
    errors.name = PARTNERS_COPY.partnerForm.errors.nameRequired;
  } else if (nameTrimmed.length > PARTNER_NAME_MAX_LENGTH) {
    errors.name = PARTNERS_COPY.partnerForm.errors.nameTooLong;
  }

  const addressTrimmed = values.address.trim();
  if (addressTrimmed.length === 0) {
    errors.address = PARTNERS_COPY.partnerForm.errors.addressRequired;
  } else if (addressTrimmed.length > PARTNER_ADDRESS_MAX_LENGTH) {
    errors.address = PARTNERS_COPY.partnerForm.errors.addressTooLong;
  }

  const photoTrimmed = values.photoUrl.trim();
  if (photoTrimmed.length > 0) {
    if (!photoTrimmed.startsWith('https://') || photoTrimmed.length > 2048) {
      errors.photoUrl = PARTNERS_COPY.partnerForm.errors.photoUrlInvalid;
    }
  }

  if (values.tags.length > PARTNER_TAGS_MAX) {
    errors.tags = PARTNERS_COPY.partnerForm.errors.tagsTooMany;
  } else if (values.tags.some((t) => t.length > PARTNER_TAG_MAX_LENGTH)) {
    errors.tags = PARTNERS_COPY.partnerForm.errors.tagTooLong;
  }

  return errors;
}

export function buildPartnerPatch(
  current: AdminPartner,
  next: {
    name: string;
    address: string;
    photoUrl: string;
    tags: string[];
  },
): UpdatePartnerBody | null {
  const patch: UpdatePartnerBody = {};

  const nameTrimmed = next.name.trim();
  if (nameTrimmed !== current.name) {
    patch.name = nameTrimmed;
  }

  const addressTrimmed = next.address.trim();
  if (addressTrimmed !== current.address) {
    patch.address = addressTrimmed;
  }

  const nextPhoto = next.photoUrl.trim();
  const normalizedNextPhoto = nextPhoto.length > 0 ? nextPhoto : null;
  if (normalizedNextPhoto !== current.photoUrl) {
    patch.photoUrl = normalizedNextPhoto;
  }

  const tagsChanged =
    next.tags.length !== current.tags.length || next.tags.some((t, i) => t !== current.tags[i]);
  if (tagsChanged) {
    patch.tags = next.tags;
  }

  if (Object.keys(patch).length === 0) {
    return null;
  }

  return patch;
}

export function mapPartnerApiFieldError(error: unknown): Partial<Record<PartnerFormField | 'pin', string>> {
  if (!isApiError(error)) return {};

  const errors: Partial<Record<PartnerFormField | 'pin', string>> = {};

  // PARTNER_INVALID: meta.field có thể là name, address, tags, photoUrl
  if (error.code === 'PARTNER_INVALID' && typeof error.meta?.field === 'string') {
    const field = error.meta.field;
    if (field === 'name' || field === 'address' || field === 'tags' || field === 'photoUrl') {
      errors[field] = PARTNERS_COPY.fieldErrors[field];
    }
  }

  // PARTNER_PIN_INVALID
  if (error.code === 'PARTNER_PIN_INVALID') {
    errors.pin = PARTNERS_COPY.fieldErrors.pin;
  }

  // VALIDATION_FAILED: error.fieldErrors = [{ path, message }]
  if (error.code === 'VALIDATION_FAILED') {
    for (const item of error.fieldErrors) {
      const field = item.path.split('.')[0];
      if (
        field === 'name' ||
        field === 'address' ||
        field === 'tags' ||
        field === 'photoUrl' ||
        field === 'pin'
      ) {
        errors[field] = PARTNERS_COPY.fieldErrors[field];
      }
    }
  }

  return errors;
}
