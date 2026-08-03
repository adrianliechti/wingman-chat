import type JSZip from "jszip";
import { fail, readRelationships, relationshipPath, type OoxmlIssue } from "./ooxml";

const RELATIONSHIPS = "ooxml.relationships";

const REFERENCED_ID = /=\s*"(rId\d+)"/g;

/**
 * Word and PowerPoint report a package as unreadable when a part references a relationship that is
 * missing, or when a declared relationship points at a part that is not in the zip — neither of
 * which stops python-docx/python-pptx from writing the file.
 */
export async function validateOoxmlRelationships(zip: JSZip, partPaths: string[]): Promise<OoxmlIssue[]> {
  const issues: OoxmlIssue[] = [];
  for (const partPath of partPaths) {
    const xml = await zip.file(partPath)?.async("string");
    if (!xml) continue;

    const relationships = await readRelationships(zip, partPath);
    const declared = new Set(relationships.map((relationship) => relationship.id));

    for (const relationship of relationships) {
      if (relationship.external || !relationship.path) continue;
      if (!zip.file(relationship.path)) {
        issues.push(
          fail(RELATIONSHIPS, `${partPath} relationship ${relationship.id} targets missing part ${relationship.path}`),
        );
      }
    }

    const referenced = new Set([...xml.matchAll(REFERENCED_ID)].map((match) => match[1]));
    for (const id of referenced) {
      if (!declared.has(id)) {
        issues.push(
          fail(RELATIONSHIPS, `${partPath} references ${id}, which is not declared in ${relationshipPath(partPath)}`),
        );
      }
    }
  }
  return issues;
}
