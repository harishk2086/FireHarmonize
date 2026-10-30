/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        space: {
          900: '#0B0F19',
          800: '#111827',
          700: '#1F2937',
          600: '#374151',
        },
        nasa: {
          blue: '#113366',
          red: '#FC3D21',
          gold: '#F59E0B',
          cyan: '#06B6D4',
        },
        modis: '#3B82F6',
        viirs: '#10B981',
        harmonized: '#F59E0B',
      },
    },
  },
  plugins: [],
}