import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "./src/index.ts",
  outDir: "./dist",
  exports: { devExports: "bun" },
  format: "esm",
  target: "es2022",
  sourcemap: true,
  clean: true,
  dts: true,
  tsconfig: "./tsconfig.json",
});
