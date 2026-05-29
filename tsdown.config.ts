import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: 'src/index.ts',
  outDir: 'dist',
  platform: 'node',
  format: 'esm',
  minify: true,
  clean: true,
  dts: false,
  outputOptions: {
    // Ensure the output file matches the bin path in package.json
    entryFileNames: 'index.js',
  },
});
