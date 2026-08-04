import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        pulse: {
          accent: "#2563EB",
          bg: "#FAFAFA",
          panel: "#FFFFFF",
          line: "#E5E7EB",
          text: "#0F172A",
          muted: "#6B7280",
          tag: "#F3F4F6"
        }
      },
      fontFamily: {
        sans: ["'Inter'", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "monospace"]
      }
    }
  },
  plugins: []
};

export default config;
