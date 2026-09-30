import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0f172a',
          accent: '#6366f1',
        },
      },
    },
  },
  plugins: [],
};

export default config;
