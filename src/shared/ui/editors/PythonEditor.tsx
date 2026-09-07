import { ExecutionEditor, type ExecutionEditorProps } from "./ExecutionEditor";

export function PythonEditor(props: ExecutionEditorProps) {
  return <ExecutionEditor {...props} language="python" />;
}
