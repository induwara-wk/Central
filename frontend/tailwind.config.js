/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // Design token palette
        base:    '#0c0c14',   // page background — near-black with purple shift
        surface: '#141420',   // card background
        edge:    '#1e1e32',   // border
        ink:     '#d4d4f0',   // primary text — off-white with blue tint
        dim:     '#4a4a6a',   // muted text
        teal:    '#00e0a0',   // healthy / accent
        amber:   '#f0a030',   // warning
        rose:    '#e04060',   // danger
      },
      boxShadow: {
        glow: '0 0 16px 0 rgba(0,224,160,0.15)',
      },
    },
  },
  plugins: [],
}
