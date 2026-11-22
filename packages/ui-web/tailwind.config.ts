import { createRequire } from 'node:module';
import type { Config } from 'tailwindcss';

const require = createRequire(import.meta.url);

const config: Config = {
  content: ['./src/**/*.{ts,tsx}', './.storybook/**/*'],
  presets: [require('@tamgiao/ui-tokens/tailwind-preset')],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
