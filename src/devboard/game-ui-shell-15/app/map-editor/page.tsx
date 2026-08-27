import { Suspense } from 'react'
import { CreationPage } from '@/components/creation-page'

export default function MapEditorPage() {
  return <Suspense fallback={null}><CreationPage tool="map-editor" /></Suspense>
}
