/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Odoo Enterprise palette from SPEC section 8.
        plum: {
          50: '#f7f2f5',
          100: '#ecdfe7',
          200: '#d8bfcd',
          300: '#bd95aa',
          400: '#a06e88',
          500: '#8a5772',
          600: '#714b67',
          700: '#5c3d54',
          800: '#4a3144',
          900: '#3b2736',
        },
        teal: {
          50: '#eefafa',
          100: '#d5f2f3',
          200: '#aee5e8',
          300: '#7cd2d8',
          400: '#45b6c0',
          500: '#2099a4',
          600: '#017e84',
          700: '#02666c',
          800: '#055157',
          900: '#084348',
        },
        ink: '#2d3748',
        surface: '#f8fafc',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 8px 24px -12px rgba(15, 23, 42, 0.15)',
      },
    },
  },
  plugins: [],
};
