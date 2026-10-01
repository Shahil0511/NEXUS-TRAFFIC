/** WHY: Tailwind v4 runs as a single PostCSS plugin; tokens live in src/app/globals.css. */
const config = {
  plugins: { '@tailwindcss/postcss': {} },
};

export default config;
