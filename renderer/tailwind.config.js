/** @type {import('tailwindcss').Config} */
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Tight"', 'Inter', 'system-ui', 'sans-serif']
      },
      colors: {
        safewave: {
          base: '#0B0C10',
          panel: '#111217',
          neon: '#1A1C23'
        }
      }
    }
  },
  plugins: []
}

