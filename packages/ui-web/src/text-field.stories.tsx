import type { Meta, StoryObj } from '@storybook/react-vite';
import { TextField } from './text-field.js';

const meta = {
  title: 'Components/TextField',
  component: TextField,
  tags: ['autodocs'],
  args: {
    label: 'Họ và tên',
    placeholder: 'Nguyễn Văn A',
    hint: 'Nhập tên theo giấy tờ tuỳ thân',
  },
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithError: Story = {
  args: {
    label: 'Email',
    defaultValue: 'invalid-email',
    error: 'Địa chỉ email không đúng định dạng',
  },
};

export const Disabled: Story = {
  args: {
    label: 'Số CCCD',
    defaultValue: '001200001234',
    disabled: true,
    hint: 'Không thể thay đổi sau khi xác thực',
  },
};
