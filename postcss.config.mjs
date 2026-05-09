// Tailwind v4 via @tailwindcss/postcss so the PolicyEngine ui-kit theme tokens
// load through the same pipeline as the other PolicyEngine Next.js apps.
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
