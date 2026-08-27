/** @type {import('next').NextConfig} */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '../../..')
const shimsDir = path.join(__dirname, 'lib/shims')

const shimPath = (name) => path.join(shimsDir, name)

const nextConfig = {
  turbopack: {
    root: repoRoot,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@core': path.resolve(repoRoot, 'src/core'),
      '@play': path.resolve(repoRoot, 'src/play'),
      '@ui': path.resolve(repoRoot, 'src/ui'),
      '@devboard': path.resolve(repoRoot, 'src/devboard'),
      'node:fs': shimPath('node-fs.ts'),
      'node:path': shimPath('node-path.ts'),
      'node:url': shimPath('node-url.ts'),
      'node:buffer': shimPath('node-buffer.ts'),
      'node:stream': shimPath('node-stream.ts'),
      'node:os': shimPath('node-os.ts'),
      'node:crypto': shimPath('node-crypto.ts'),
    }
    return config
  },
}

export default nextConfig
