import { Suspense } from 'react'
import { CreationPage } from '@/components/creation-page'

export default function ResearchBenchPage() {
  return <Suspense fallback={null}><CreationPage tool="research-bench" /></Suspense>
}
