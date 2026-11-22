// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomePage } from './home-page';

describe('HomePage', () => {
  it('hiển thị tiêu đề Quán đối tác', () => {
    render(<HomePage />);
    expect(screen.getByText(/Quán đối tác/)).toBeTruthy();
  });
});
