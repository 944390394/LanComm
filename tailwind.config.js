/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,js,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: 'rgb(var(--ink-950) / <alpha-value>)',
          900: 'rgb(var(--ink-900) / <alpha-value>)',
          800: 'rgb(var(--ink-800) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          500: 'rgb(var(--ink-500) / <alpha-value>)',
          300: 'rgb(var(--ink-300) / <alpha-value>)',
          100: 'rgb(var(--ink-100) / <alpha-value>)'
        },
        mint: {
          400: 'rgb(var(--mint-400) / <alpha-value>)',
          500: 'rgb(var(--mint-500) / <alpha-value>)',
          600: 'rgb(var(--mint-600) / <alpha-value>)'
        },
        sand: {
          100: 'rgb(var(--sand-100) / <alpha-value>)',
          200: 'rgb(var(--sand-200) / <alpha-value>)'
        }
      },
      fontFamily: {
        display: ['Sora', 'Segoe UI', 'sans-serif'],
        body: ['IBM Plex Sans', 'Segoe UI', 'sans-serif']
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        pulseDot: {
          '0%, 100%': { opacity: '0.45', transform: 'scale(0.9)' },
          '50%': { opacity: '1', transform: 'scale(1)' }
        },
        progressGlow: {
          '0%': { filter: 'brightness(1)' },
          '50%': { filter: 'brightness(1.15)' },
          '100%': { filter: 'brightness(1)' }
        }
      },
      animation: {
        rise: 'rise 0.35s ease-out both',
        'pulse-dot': 'pulseDot 1.6s ease-in-out infinite',
        'progress-glow': 'progressGlow 1.8s ease-in-out infinite'
      }
    }
  },
  plugins: []
}
