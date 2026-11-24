import { describe, expect, it } from 'vitest';
import { ApiError } from '@tamgiao/api-client';
import type { AdminPartner } from '@tamgiao/contracts/billing';
import { PARTNERS_COPY } from './copy';
import { buildPartnerPatch, mapPartnerApiFieldError, parseTags, validatePartnerForm } from './partner-form';

describe('partner-form', () => {
  describe('parseTags', () => {
    it('tách theo dấu phẩy, dòng mới, trim và bỏ trùng', () => {
      const raw = ' cà phê,  trà sữa\nyên tĩnh , lãng mạn\r\ncà phê, hẹn hò, ';
      const tags = parseTags(raw);
      expect(tags).toEqual(['cà phê', 'trà sữa', 'yên tĩnh', 'lãng mạn', 'hẹn hò']);
    });

    it('chuỗi rỗng trả về mảng rỗng', () => {
      expect(parseTags('')).toEqual([]);
      expect(parseTags('   , \n \r\n ')).toEqual([]);
    });
  });

  describe('validatePartnerForm', () => {
    it('hợp lệ trả về object rỗng', () => {
      const errors = validatePartnerForm({
        name: 'The Coffee House',
        address: '86 Cao Thắng, Quận 3',
        photoUrl: 'https://example.com/photo.jpg',
        tags: ['cafe', 'lãng mạn'],
      });
      expect(errors).toEqual({});
    });

    it('kiểm tra lỗi tên rỗng hoặc quá dài', () => {
      expect(
        validatePartnerForm({
          name: '   ',
          address: 'Địa chỉ',
          photoUrl: '',
          tags: [],
        }).name,
      ).toBe(PARTNERS_COPY.partnerForm.errors.nameRequired);

      expect(
        validatePartnerForm({
          name: 'a'.repeat(121),
          address: 'Địa chỉ',
          photoUrl: '',
          tags: [],
        }).name,
      ).toBe(PARTNERS_COPY.partnerForm.errors.nameTooLong);
    });

    it('kiểm tra lỗi địa chỉ rỗng hoặc quá dài', () => {
      expect(
        validatePartnerForm({
          name: 'Tên quán',
          address: '',
          photoUrl: '',
          tags: [],
        }).address,
      ).toBe(PARTNERS_COPY.partnerForm.errors.addressRequired);

      expect(
        validatePartnerForm({
          name: 'Tên quán',
          address: 'a'.repeat(301),
          photoUrl: '',
          tags: [],
        }).address,
      ).toBe(PARTNERS_COPY.partnerForm.errors.addressTooLong);
    });

    it('kiểm tra photoUrl không phải https hoặc quá dài', () => {
      expect(
        validatePartnerForm({
          name: 'Tên quán',
          address: 'Địa chỉ',
          photoUrl: 'http://example.com/photo.jpg',
          tags: [],
        }).photoUrl,
      ).toBe(PARTNERS_COPY.partnerForm.errors.photoUrlInvalid);

      expect(
        validatePartnerForm({
          name: 'Tên quán',
          address: 'Địa chỉ',
          photoUrl: `https://${'a'.repeat(2050)}.com`,
          tags: [],
        }).photoUrl,
      ).toBe(PARTNERS_COPY.partnerForm.errors.photoUrlInvalid);
    });

    it('kiểm tra số lượng và độ dài tags', () => {
      const elevenTags = Array.from({ length: 11 }, (_, i) => `tag-${i}`);
      expect(
        validatePartnerForm({
          name: 'Tên quán',
          address: 'Địa chỉ',
          photoUrl: '',
          tags: elevenTags,
        }).tags,
      ).toBe(PARTNERS_COPY.partnerForm.errors.tagsTooMany);

      expect(
        validatePartnerForm({
          name: 'Tên quán',
          address: 'Địa chỉ',
          photoUrl: '',
          tags: ['a'.repeat(31)],
        }).tags,
      ).toBe(PARTNERS_COPY.partnerForm.errors.tagTooLong);
    });
  });

  describe('buildPartnerPatch', () => {
    const current: AdminPartner = {
      id: '01890a5d-ac96-774b-bcce-b302099a8001',
      name: 'The Coffee House',
      address: '86 Cao Thắng, Quận 3',
      photoUrl: 'https://example.com/photo.jpg',
      tags: ['cafe', 'lãng mạn'],
      active: true,
      createdAt: '2026-11-20T08:00:00.000Z',
      updatedAt: '2026-11-20T08:00:00.000Z',
    };

    it('không đổi gì → trả về null', () => {
      const patch = buildPartnerPatch(current, {
        name: 'The Coffee House',
        address: '86 Cao Thắng, Quận 3',
        photoUrl: 'https://example.com/photo.jpg',
        tags: ['cafe', 'lãng mạn'],
      });
      expect(patch).toBeNull();
    });

    it('chỉ đổi tên → patch chỉ chứa name', () => {
      const patch = buildPartnerPatch(current, {
        name: 'The Coffee House Mới',
        address: '86 Cao Thắng, Quận 3',
        photoUrl: 'https://example.com/photo.jpg',
        tags: ['cafe', 'lãng mạn'],
      });
      expect(patch).toEqual({ name: 'The Coffee House Mới' });
    });

    it('chỉ gỡ ảnh → patch photoUrl: null', () => {
      const patch = buildPartnerPatch(current, {
        name: 'The Coffee House',
        address: '86 Cao Thắng, Quận 3',
        photoUrl: '',
        tags: ['cafe', 'lãng mạn'],
      });
      expect(patch).toEqual({ photoUrl: null });
    });

    it('thêm ảnh khi trước đó không có', () => {
      const withoutPhoto: AdminPartner = { ...current, photoUrl: null };
      const patch = buildPartnerPatch(withoutPhoto, {
        name: 'The Coffee House',
        address: '86 Cao Thắng, Quận 3',
        photoUrl: 'https://example.com/new.jpg',
        tags: ['cafe', 'lãng mạn'],
      });
      expect(patch).toEqual({ photoUrl: 'https://example.com/new.jpg' });
    });

    it('chỉ đổi tags → patch chỉ chứa tags', () => {
      const patch = buildPartnerPatch(current, {
        name: 'The Coffee House',
        address: '86 Cao Thắng, Quận 3',
        photoUrl: 'https://example.com/photo.jpg',
        tags: ['cafe', 'yên tĩnh'],
      });
      expect(patch).toEqual({ tags: ['cafe', 'yên tĩnh'] });
    });
  });

  describe('mapPartnerApiFieldError', () => {
    it('map PARTNER_INVALID theo meta.field', () => {
      const errName = new ApiError({
        code: 'PARTNER_INVALID',
        status: 422,
        message: 'Invalid partner',
        meta: { field: 'name' },
      });
      expect(mapPartnerApiFieldError(errName)).toEqual({
        name: PARTNERS_COPY.fieldErrors.name,
      });

      const errAddress = new ApiError({
        code: 'PARTNER_INVALID',
        status: 422,
        message: 'Invalid partner',
        meta: { field: 'address' },
      });
      expect(mapPartnerApiFieldError(errAddress)).toEqual({
        address: PARTNERS_COPY.fieldErrors.address,
      });
    });

    it('map PARTNER_PIN_INVALID', () => {
      const err = new ApiError({
        code: 'PARTNER_PIN_INVALID',
        status: 422,
        message: 'Invalid PIN',
      });
      expect(mapPartnerApiFieldError(err)).toEqual({
        pin: PARTNERS_COPY.fieldErrors.pin,
      });
    });

    it('map VALIDATION_FAILED theo fieldErrors path', () => {
      const err = new ApiError({
        code: 'VALIDATION_FAILED',
        status: 422,
        message: 'Validation failed',
        fieldErrors: [
          { path: 'name', message: 'Too long' },
          { path: 'tags.0', message: 'Invalid tag' },
          { path: 'pin', message: 'Invalid pin' },
        ],
      });
      expect(mapPartnerApiFieldError(err)).toEqual({
        name: PARTNERS_COPY.fieldErrors.name,
        tags: PARTNERS_COPY.fieldErrors.tags,
        pin: PARTNERS_COPY.fieldErrors.pin,
      });
    });

    it('lỗi khác hoặc không phải ApiError trả về object rỗng', () => {
      expect(mapPartnerApiFieldError(new Error('Unknown'))).toEqual({});
      expect(mapPartnerApiFieldError(null)).toEqual({});
    });
  });
});
