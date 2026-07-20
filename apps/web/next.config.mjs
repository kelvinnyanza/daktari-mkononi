/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript sources consumed directly.
  transpilePackages: ['@daktari/schemas'],
  eslint: { ignoreDuringBuilds: true }, // linted by the repo-root eslint config
};

export default nextConfig;
