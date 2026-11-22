import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button.js';
import { ToastProvider, useToast } from './toast.js';

function ToastDemo() {
  const { showToast } = useToast();

  return (
    <div className="flex flex-wrap gap-space-sm">
      <Button variant="primary" onClick={() => showToast('Đã gửi mã OTP mới!', 'primary')}>
        Toast Primary
      </Button>
      <Button variant="secondary" onClick={() => showToast('Cập nhật hồ sơ thành công', 'success')}>
        Toast Success
      </Button>
      <Button variant="danger" onClick={() => showToast('Có lỗi xảy ra khi xác thực', 'danger')}>
        Toast Danger
      </Button>
    </div>
  );
}

const meta = {
  title: 'Components/Toast',
  component: ToastDemo,
  decorators: [
    (Story) => (
      <ToastProvider>
        <Story />
      </ToastProvider>
    ),
  ],
  tags: ['autodocs'],
} satisfies Meta<typeof ToastDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
