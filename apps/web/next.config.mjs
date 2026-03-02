import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(__dirname, "../../"),
  outputFileTracingIncludes: {
    ".": ["./node_modules/next/dist/build/webpack/loaders/postcss-loader/**"],
  },
  typedRoutes: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
