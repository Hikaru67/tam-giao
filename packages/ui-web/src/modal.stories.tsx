import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button.js';
import { Modal } from './modal.js';

function ModalDemo() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <Button onClick={() => setOpen(true)}>Mở hộp thoại</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Xác nhận tiếp tục">
        <p className="text-body-md text-secondary mb-space-md">
          Bạn có chắc chắn muốn rời khỏi màn hình này? Dữ liệu chưa lưu có thể bị mất.
        </p>
        <div className="flex justify-end gap-space-sm">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Huỷ
          </Button>
          <Button variant="primary" onClick={() => setOpen(false)}>
            Đồng ý
          </Button>
        </div>
      </Modal>
    </div>
  );
}

const meta = {
  title: 'Components/Modal',
  component: ModalDemo,
  tags: ['autodocs'],
} satisfies Meta<typeof ModalDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
