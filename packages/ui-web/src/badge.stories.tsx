import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from './badge.js';

const meta = {
  title: 'Components/Badge',
  component: Badge,
  tags: ['autodocs'],
  args: {
    children: 'Đã xác thực',
    tone: 'success',
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  args: {
    tone: 'success',
    children: 'eKYC Hoàn tất',
  },
};

export const Primary: Story = {
  args: {
    tone: 'primary',
    children: 'Ưu tiên',
  },
};

export const Warning: Story = {
  args: {
    tone: 'warning',
    children: 'Chờ đối phương',
  },
};

export const Danger: Story = {
  args: {
    tone: 'danger',
    children: 'Đã từ chối',
  },
};

export const Neutral: Story = {
  args: {
    tone: 'neutral',
    children: 'Tiền Hôn Nhân',
  },
};
