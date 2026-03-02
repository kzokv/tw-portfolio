/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        body: ["var(--font-body)", "Noto Sans TC", "sans-serif"],
        display: ["var(--font-display)", "Noto Serif TC", "serif"],
      },
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-soft": "var(--surface-soft)",
        "surface-glass": "var(--surface-glass)",
        ink: "var(--text)",
        muted: "var(--muted)",
        accent: "var(--accent)",
        "accent-strong": "var(--accent-strong)",
        line: "var(--line)",
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
      },
      boxShadow: {
        card: "0 24px 80px rgba(2, 6, 23, 0.45)",
        focus: "0 0 0 4px rgba(111, 76, 255, 0.28)",
        glass: "inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 18px 56px rgba(2, 6, 23, 0.42)",
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.45s ease-out both",
      },
      backgroundImage: {
        sheen: "linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0))",
      },
    },
  },
  plugins: [],
};

export default config;
