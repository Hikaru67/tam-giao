import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button.js';

const meta = {
  title: 'Components/Button',
  component: Button,
  tags: ['autodocs'],
  args: {
    children: 'Tiếp tục',
    variant: 'primary',
    size: 'md',
    loading: false,
    disabled: false,
    fullWidth: false,
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Secondary: Story = {
  args: {
    variant: 'secondary',
    children: 'Quay lại',
  },
};

export const Ghost: Story = {
  args: {
    variant: 'ghost',
    children: 'Bỏ qua',
  },
};

export const Danger: Story = {
  args: {
    variant: 'danger',
    children: 'Huỷ tài khoản',
  },
};

export const Loading: Story = {
  args: {
    loading: true,
    children: 'Đang gửi mã...',
  },
};

export const FullWidth: Story = {
  args: {
    fullWidth: true,
    children: 'Đăng nhập',
  },
};
