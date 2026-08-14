import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // Intentionally empty. Platform thumbnail CDNs are not a fixed, enumerable
    // set of hosts, so candidate previews render through a plain <img> rather
    // than next/image. A post whose thumbnail cannot be shown displays an
    // explicit "no preview" placeholder — never a substituted image.
    remotePatterns: [],
  },
};

export default nextConfig;
