import { Suspense } from 'react'
import { CreationPage } from '@/components/creation-page'

export default function AssetLibraryPage() {
  return <Suspense fallback={null}><CreationPage tool="asset-library" /></Suspense>
}
