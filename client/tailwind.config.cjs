/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0d0d0d',
        sidebar: '#111111',
        tree: '#111111',
        chat: '#0d0d0d',
        bubbleUser: '#2f2f2f',
        inputBg: '#1e1e1e',
        borderSubtle: '#1f2933'
      }
    }
  },
  plugins: []
};

