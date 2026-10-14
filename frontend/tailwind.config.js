/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        indigo: {
          500: '#4f46e5',
          600: '#4338ca',
        },
        electric: '#00f2fe',
        neonpink: '#fe0979'
      }
    },
  },
  plugins: [],
}
