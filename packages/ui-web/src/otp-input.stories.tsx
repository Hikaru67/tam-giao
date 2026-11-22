import type { Meta, StoryObj } from '@storybook/react-vite';
import { OtpInput } from './otp-input.js';

const meta = {
  title: 'Components/OtpInput',
  component: OtpInput,
  tags: ['autodocs'],
  args: {
    onComplete: () => {},
  },
} satisfies Meta<typeof OtpInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithError: Story = {
  args: {
    error: 'Mã OTP không chính xác, vui lòng thử lại',
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};
