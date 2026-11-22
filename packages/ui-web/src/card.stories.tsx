import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card } from './card.js';

const meta = {
  title: 'Components/Card',
  component: Card,
  tags: ['autodocs'],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <div>
        <h4 className="text-title-md font-bold mb-space-xs">Lưu ý an toàn</h4>
        <p className="text-body-sm text-secondary">
          Tâm Giao cam kết bảo mật thông tin cá nhân theo Nghị định 13/2023/NĐ-CP.
        </p>
      </div>
    ),
  },
};
