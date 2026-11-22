import type { Meta, StoryObj } from '@storybook/react-vite';
import { ErrorState } from './error-state.js';

const meta = {
  title: 'Components/ErrorState',
  component: ErrorState,
  tags: ['autodocs'],
  args: {
    title: 'Không thể kết nối đến máy chủ',
    action: 'Thử lại ngay',
    onRetry: () => {},
  },
} satisfies Meta<typeof ErrorState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
