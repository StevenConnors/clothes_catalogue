import type { NextConfig } from 'next';
const config: NextConfig = {
 images: { deviceSizes: [320, 480, 640], imageSizes: [] },
 webpack(config) {
  config.watchOptions = { ...config.watchOptions, ignored: ['**/node_modules/**','**/.git/**','**/.venv/**','**/wardrobe-data/**'], poll: 1000 };
  return config;
 },
};
export default config;
