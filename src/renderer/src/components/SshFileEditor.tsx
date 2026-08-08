import { lazy, Suspense } from 'react'
import { Spin } from 'antd'
import type { EditorProps } from '@monaco-editor/react'

const MonacoFileEditor = lazy(() => import('./MonacoFileEditor'))

export default function SshFileEditor(props: EditorProps): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center">
          <Spin />
        </div>
      }
    >
      <MonacoFileEditor {...props} />
    </Suspense>
  )
}
