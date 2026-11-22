import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar } from './avatar.js';

const meta = {
  title: 'Components/Avatar',
  component: Avatar,
  tags: ['autodocs'],
  args: {
    initials: 'TG',
    size: 'md',
  },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Initials: Story = {};

export const WithImage: Story = {
  args: {
    src: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
    alt: 'Mai Hương',
  },
};

export const Large: Story = {
  args: {
    size: 'lg',
    initials: 'TG',
  },
};

export const Small: Story = {
  args: {
    size: 'sm',
    initials: 'TG',
  },
};
