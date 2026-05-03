import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  target: 'node22',
  banner: {
    js: '#!/usr/bin/env node',
  },
  noExternal: ['@ksef2gdrive/core'],
})
