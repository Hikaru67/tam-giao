import type { Meta, StoryObj } from '@storybook/react-vite';
import { Stepper } from './stepper.js';

const meta = {
  title: 'Components/Stepper',
  component: Stepper,
  tags: ['autodocs'],
  args: {
    steps: [
      { label: 'Số điện thoại', state: 'done' },
      { label: 'Xác thực OTP', state: 'current' },
      { label: 'Hồ sơ', state: 'todo' },
      { label: 'Tiêu chí', state: 'todo' },
    ],
  },
} satisfies Meta<typeof Stepper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
