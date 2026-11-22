import type { Meta, StoryObj } from '@storybook/react-vite';
import { Countdown } from './countdown.js';

const futureDate = new Date(Date.now() + 24 * 60 * 1000 + 35 * 1000);

const meta = {
  title: 'Components/Countdown',
  component: Countdown,
  tags: ['autodocs'],
  args: {
    expiresAt: futureDate,
    prefixText: 'Gửi lại mã sau',
  },
} satisfies Meta<typeof Countdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const HoursRemaining: Story = {
  args: {
    expiresAt: new Date(Date.now() + 2 * 3600 * 1000 + 15 * 60 * 1000),
    prefixText: 'Hết hạn sau',
  },
};
