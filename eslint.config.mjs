import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  // coverage/ is generated istanbul output — gitignored, and not ours to lint.
  { ignores: [".next/**", "node_modules/**", ".vercel/**", "public/**", "coverage/**", "next-env.d.ts"] },
  ...coreWebVitals,
  ...typescript,
];

export default config;
