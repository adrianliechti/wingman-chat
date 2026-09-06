import { ExecutionEditor, type ExecutionEditorProps } from "./ExecutionEditor";

export function JsEditor(props: ExecutionEditorProps) {
  return <ExecutionEditor {...props} language="javascript" />;
}
