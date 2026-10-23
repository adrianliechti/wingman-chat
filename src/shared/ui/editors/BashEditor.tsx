import { ExecutionEditor, type ExecutionEditorProps } from "./ExecutionEditor";

export function BashEditor(props: ExecutionEditorProps) {
  return <ExecutionEditor {...props} language="bash" />;
}
