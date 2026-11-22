import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OtpInput } from './otp-input.js';

describe('OtpInput', () => {
  it('dán chuỗi 6 số kích hoạt onComplete đúng 1 lần', () => {
    const onComplete = vi.fn();
    render(<OtpInput onComplete={onComplete} />);

    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(6);

    fireEvent.paste(inputs[0]!, {
      clipboardData: {
        getData: () => '842915',
      },
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('842915');
    expect(inputs.map((input) => (input as HTMLInputElement).value)).toEqual(['8', '4', '2', '9', '1', '5']);
  });

  it('gõ lần lượt từng số đến chữ số thứ 6 và hỗ trợ Backspace lùi ô', () => {
    const onComplete = vi.fn();
    render(<OtpInput onComplete={onComplete} />);

    const inputs = screen.getAllByRole('textbox');

    fireEvent.change(inputs[0]!, { target: { value: '1' } });
    fireEvent.change(inputs[1]!, { target: { value: '2' } });
    fireEvent.change(inputs[2]!, { target: { value: '3' } });
    expect(onComplete).not.toHaveBeenCalled();

    // Nhấn Backspace ở ô thứ 3 khi rỗng để lùi về ô thứ 2
    fireEvent.keyDown(inputs[3]!, { key: 'Backspace' });

    fireEvent.change(inputs[3]!, { target: { value: '4' } });
    fireEvent.change(inputs[4]!, { target: { value: '5' } });
    fireEvent.change(inputs[5]!, { target: { value: '6' } });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
  });
});
