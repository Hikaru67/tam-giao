import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PhoneInput } from './phone-input.js';

describe('PhoneInput', () => {
  it('nhập 0912 345 678 -> onChangeE164 trả về +84912345678', () => {
    const onChangeE164 = vi.fn();
    render(<PhoneInput label="Số điện thoại" onChangeE164={onChangeE164} />);

    const input = screen.getByLabelText('Số điện thoại');
    fireEvent.change(input, { target: { value: '0912 345 678' } });

    expect(onChangeE164).toHaveBeenLastCalledWith('+84912345678');
  });

  it('nhập số không hợp lệ -> onChangeE164 trả về null', () => {
    const onChangeE164 = vi.fn();
    render(<PhoneInput label="Số điện thoại" onChangeE164={onChangeE164} />);

    const input = screen.getByLabelText('Số điện thoại');
    fireEvent.change(input, { target: { value: '012345' } });

    expect(onChangeE164).toHaveBeenLastCalledWith(null);
  });
});
