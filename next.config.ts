import type { NextConfig } from 'next';
const config: NextConfig = {
 webpack(config) {
  config.watchOptions = { ...config.watchOptions, ignored: ['**/node_modules/**','**/.git/**','**/.venv/**','**/wardrobe-data/**'], poll: 1000 };
  return config;
 },
};
export default config;
