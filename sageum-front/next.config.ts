import type { NextConfig } from 'next';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withWorkflow } from 'workflow/next';

const appRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: appRoot,
  },
};

export default withWorkflow(nextConfig);
