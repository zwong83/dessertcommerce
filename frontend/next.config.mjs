import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const config = {
  devIndicators: false,
  turbopack: { root: fileURLToPath(new URL("../", import.meta.url)) },
  async headers() {
    return [{ source: "/sw.js", headers: [
      { key: "Cache-Control", value: "no-store" },
      { key: "Content-Type", value: "application/javascript; charset=utf-8" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ] }];
  },
};

export default config;
