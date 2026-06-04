import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'dist/test/suite/**/*.test.js',
  version: 'stable',
  mocha: {
    timeout: 60000,
    ui: 'tdd',
  },
});
