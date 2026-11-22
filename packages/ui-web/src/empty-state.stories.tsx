import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button.js';
import { EmptyState } from './empty-state.js';

const meta = {
  title: 'Components/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
  args: {
    title: 'Chưa có gợi ý ghép đôi',
    description: 'Chuyên viên mai mối đang tìm kiếm đối tượng phù hợp nhất với tiêu chí của bạn.',
    action: <Button variant="primary">Cập nhật tiêu chí</Button>,
    icon: '💌',
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
