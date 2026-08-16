import { build } from "esbuild";

await build({
  entryPoints: ["src/preload.ts"],
  outfile: "dist/preload.js",
  bundle: true,
  external: ["electron"],
  format: "cjs",
  platform: "node",
  sourcemap: true,
  target: "node22",
  logLevel: "info",
});
