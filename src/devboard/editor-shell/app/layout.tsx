import type { ReactNode } from 'react'

/**
 * Shell layout kept as a plain wrapper so the imported v0 shell stays Vite-compatible.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return <>{children}</>
}
