/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Manrope", "system-ui", "sans-serif"],
        display: ["Playfair Display", "Georgia", "serif"]
      },
      colors: {
        sand: {
          50: "#fbf7f2",
          100: "#f4ece1",
          200: "#e9dbc7",
          300: "#dac19d",
          400: "#c9a670",
          500: "#b58b49",
          600: "#936d35",
          700: "#74552d",
          800: "#624929",
          900: "#553f26"
        },
        stoneInk: "#111316",
        clay: "#ac6c43",
        fog: "#f6f4ef",
        pine: "#34524a"
      },
      boxShadow: {
        luxe: "0 18px 50px rgba(17, 19, 22, 0.08)",
        soft: "0 12px 24px rgba(17, 19, 22, 0.06)"
      },
      backgroundImage: {
        "hero-radial":
          "radial-gradient(circle at top right, rgba(201, 166, 112, 0.18), transparent 28%), radial-gradient(circle at 10% 10%, rgba(52, 82, 74, 0.14), transparent 24%)"
      }
    }
  },
  plugins: []
};
