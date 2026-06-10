/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50:  '#f0f3f9',
          100: '#d9e1f2',
          500: '#2f5496',
          700: '#1f3864',
          900: '#162847',
        },
        brand: {
          orange: '#ed7d31',
          green:  '#107c10',
          red:    '#c00000',
        }
      }
    }
  },
  plugins: []
}
