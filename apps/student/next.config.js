/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@college-chatbot/shared'],
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};
module.exports = nextConfig;
