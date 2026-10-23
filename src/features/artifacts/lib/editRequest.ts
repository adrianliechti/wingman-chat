/** A request to change a passage the user highlighted in an artifact viewer. */
export interface ArtifactEditRequest {
  path: string;
  /** The highlighted text, verbatim as displayed. */
  text: string;
  /** 1-based, inclusive source lines when the passage could be located. */
  startLine?: number;
  endLine?: number;
  instruction: string;
}
