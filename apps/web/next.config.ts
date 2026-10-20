import type { NextConfig } from "next";
import path from "node:path";
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  ...(process.env.CODEVIZ_DESKTOP_BUILD === "1"
    ? {
        output: "standalone" as const,
        outputFileTracingRoot: path.resolve(__dirname, "../.."),
      }
    : {}),
};
export default config;
