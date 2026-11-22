import type { Meta, StoryObj } from '@storybook/react-vite';
import { PhoneInput } from './phone-input.js';

const meta = {
  title: 'Components/PhoneInput',
  component: PhoneInput,
  tags: ['autodocs'],
  args: {
    label: 'Số điện thoại di động',
    placeholder: '0912 345 678',
    hint: 'Mã xác thực OTP sẽ được gửi qua SMS',
  },
} satisfies Meta<typeof PhoneInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithError: Story = {
  args: {
    defaultValue: '012345',
    error: 'Số điện thoại không hợp lệ',
  },
};
