/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/client/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        fk: { blue: '#2874F0', yellow: '#FFE11B', ink: '#172337' },
      },
    },
  },
  plugins: [],
};
