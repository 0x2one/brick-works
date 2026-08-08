import { Editor } from '@monaco-editor/react'
import type { EditorProps } from '@monaco-editor/react'
import './MonacoSetup'

export default function MonacoFileEditor(props: EditorProps): React.JSX.Element {
  return <Editor {...props} />
}
