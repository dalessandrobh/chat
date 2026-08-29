import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        wa: {
          green: "#25D366",
          dark: "#075E54",
          teal: "#128C7E",
          bubble: "#DCF8C6",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
