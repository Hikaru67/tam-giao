// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomePage } from './home-page';

describe('HomePage', () => {
  it('hiển thị tiêu đề Cổng quản trị', () => {
    render(<HomePage />);
    expect(screen.getByText(/Cổng quản trị/)).toBeTruthy();
  });
});
