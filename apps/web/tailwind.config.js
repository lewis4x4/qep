import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        // QEP USA Brand Color Tokens (HSL from CSS variables — theme-aware)
        "qep-orange": "hsl(var(--qep-orange) / <alpha-value>)",
        "qep-orange-hover": "hsl(var(--qep-orange-hover) / <alpha-value>)",
        "qep-orange-light": "hsl(var(--qep-orange-light) / <alpha-value>)",
        "qep-dark": "hsl(var(--qep-dark) / <alpha-value>)",
        "qep-dark-hover": "hsl(var(--qep-dark-hover) / <alpha-value>)",
        "qep-charcoal": "hsl(var(--qep-charcoal) / <alpha-value>)",
        "qep-slate": "hsl(var(--qep-slate) / <alpha-value>)",
        "qep-gray": "hsl(var(--qep-gray) / <alpha-value>)",
        "qep-light-gray": "hsl(var(--qep-light-gray) / <alpha-value>)",
        "qep-bg": "hsl(var(--qep-bg) / <alpha-value>)",
        "qep-success": "hsl(var(--success) / <alpha-value>)",
        "qep-error": "hsl(var(--qep-error) / <alpha-value>)",
        "qep-info": "hsl(var(--qep-info) / <alpha-value>)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(1)", opacity: "1" },
          "100%": { transform: "scale(1.4)", opacity: "0" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-ring": "pulse-ring 1s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fade-in 0.2s ease",
      },
    },
  },
  plugins: [typography],
};
