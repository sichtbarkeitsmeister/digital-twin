import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
        sbkm: {
          navy: "#2E2E50",
          mint: {
            DEFAULT: "#64FDC2",
            50: "#EEFFF7",
            100: "#D8FFEE",
            300: "#A1FEDB",
            500: "#64FDC2",
            600: "#36DCA4",
            700: "#1FBF8A",
          },
          ink: {
            50: "#FAFAFB",
            100: "#F4F4F7",
            200: "#ECECF1",
            300: "#DCDCE4",
            400: "#BFBFCC",
            500: "#9595A8",
            600: "#6B6B86",
            700: "#46466A",
            800: "#2E2E50",
            900: "#1A1A30",
          },
          canvas: "#EAF7F1",
        },
      },
      fontFamily: {
        sans: ["var(--font-poppins)", "system-ui", "sans-serif"],
        display: ["var(--font-clash)", "var(--font-poppins)", "system-ui", "sans-serif"],
      },
      fontSize: {
        display: [
          "clamp(2.75rem, 4.2vw + 1rem, 5.5rem)",
          { lineHeight: "1.05", letterSpacing: "-0.02em" },
        ],
        "hero-display": [
          "clamp(2.4rem, 5vw + 1rem, 5.2rem)",
          { lineHeight: "1.02", letterSpacing: "-0.005em" },
        ],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        dt: "22px",
        "dt-lg": "28px",
        pill: "999px",
      },
      boxShadow: {
        dt: "0 8px 24px rgba(46, 46, 80, 0.10)",
        "dt-lg": "0 20px 48px rgba(46, 46, 80, 0.10)",
        "dt-hover": "0 12px 32px rgba(46, 46, 80, 0.25)",
        "dt-mint": "0 12px 32px rgba(100, 253, 194, 0.35)",
        "dt-menu": "0 16px 40px rgba(46, 46, 80, 0.18)",
        "dt-focus": "0 0 0 3px rgba(100, 253, 194, 0.45)",
      },
      maxWidth: {
        dt: "1240px",
      },
      transitionTimingFunction: {
        dt: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        "dt-menu-pop": {
          from: { opacity: "0", transform: "scale(0.96) translateY(-4px)" },
          to: { opacity: "1", transform: "none" },
        },
      },
      animation: {
        "dt-menu-pop": "dt-menu-pop 220ms cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
