import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button.js';

describe('Button', () => {
  it('khi loading: bị disabled và có thuộc tính aria-busy', () => {
    render(<Button loading>Gửi mã</Button>);

    const button = screen.getByRole('button', { name: /Gửi mã/i });
    // Không dùng jest-dom (chưa cài) — assert trực tiếp thuộc tính DOM.
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('render các variant khác nhau không lỗi', () => {
    const { rerender } = render(<Button variant="primary">Nút chính</Button>);
    expect(screen.getByText('Nút chính')).toBeTruthy();

    rerender(<Button variant="secondary">Nút phụ</Button>);
    expect(screen.getByText('Nút phụ')).toBeTruthy();

    rerender(<Button variant="danger">Nút nguy hiểm</Button>);
    expect(screen.getByText('Nút nguy hiểm')).toBeTruthy();

    rerender(<Button variant="ghost">Nút trong suốt</Button>);
    expect(screen.getByText('Nút trong suốt')).toBeTruthy();
  });
});
