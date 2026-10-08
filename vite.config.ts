import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(
      process.env.GITHUB_RUN_NUMBER ? `${pkg.version.replace(/\.\d+$/, '')}.${process.env.GITHUB_RUN_NUMBER}` : `${pkg.version}-dev`,
    ),
  },
});
