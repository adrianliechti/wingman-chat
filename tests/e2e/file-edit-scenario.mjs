export const initialFiles = {
  "/policy/returns.md":
    "\uFEFF# Returns policy\r\n\r\nEU customers: 30 days.\r\nUS customers: 14 days.\r\nWarranty: 365 days.\r\nFinal-sale items are excluded.\r\n",
  "/config/returns.json":
    JSON.stringify({ euDays: 30, usDays: 14, warrantyDays: 365, excluded: ["final-sale"] }, null, 2) + "\n",
  "/web/returns.html":
    '<!doctype html>\n<html lang="en"><head><title>Returns</title></head><body>\n<h1>Returns</h1>\n<p>EU customers: 30 days.</p>\n<p>US customers: 14 days.</p>\n<p>Warranty: 365 days.</p>\n</body></html>\n',
  "/archive/returns-2024.md": "# Archived policy — do not revise\nEU customers: 30 days.\nUS customers: 14 days.\n",
  "/assets/logo.svg":
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8"/></svg>\n',
};

export const task = `Roll out the new returns windows: EU customers get 45 days and US customers get 30 days.
Update the current policy in policy/returns.md, configuration in config/returns.json, and customer page in web/returns.html consistently.
Keep the 365-day warranty and final-sale exclusion unchanged. Preserve the policy file's UTF-8 BOM and CRLF line endings.
Create exports/rollout.json containing exactly {"euDays":45,"usDays":30,"warrantyDays":365,"excluded":["final-sale"]} (formatting is up to you).
Do not change archive/returns-2024.md, assets/logo.svg, or add any other files. Verify consistency before finishing.
All paths are relative to this workspace root (virtual / in the artifact tools). Use only these local files; no network, dependency installation, or delegation. Give a concise final summary.`;

const expectedConfig = { euDays: 45, usDays: 30, warrantyDays: 365, excluded: ["final-sale"] };
function validConfig(text) {
  try {
    const parsed = JSON.parse(text);
    return (
      Object.keys(parsed).length === 4 &&
      parsed.euDays === 45 &&
      parsed.usDays === 30 &&
      parsed.warrantyDays === 365 &&
      JSON.stringify(parsed.excluded) === '["final-sale"]'
    );
  } catch {
    return false;
  }
}

/** Outcome checks, independent of tool choice, argument formatting or prose. */
export function evaluateFiles(files) {
  const policy = files["/policy/returns.md"] ?? "";
  const page = files["/web/returns.html"] ?? "";
  const checks = {
    policyContent:
      policy.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n") ===
      initialFiles["/policy/returns.md"]
        .replace(/^\uFEFF/, "")
        .replaceAll("\r\n", "\n")
        .replace("EU customers: 30", "EU customers: 45")
        .replace("US customers: 14", "US customers: 30"),
    policyBom: policy.startsWith("\uFEFF"),
    policyCrlf: policy.includes("\r\n") && !/(?<!\r)\n/.test(policy) && !/\r(?!\n)/.test(policy),
    configuration: validConfig(files["/config/returns.json"]),
    customerPage:
      page.includes("EU customers: 45 days.") &&
      page.includes("US customers: 30 days.") &&
      page.includes("Warranty: 365 days."),
    rollout: validConfig(files["/exports/rollout.json"]),
    unrelatedFiles:
      files["/archive/returns-2024.md"] === initialFiles["/archive/returns-2024.md"] &&
      files["/assets/logo.svg"] === initialFiles["/assets/logo.svg"],
    exactFileSet:
      JSON.stringify(Object.keys(files).sort()) ===
      JSON.stringify([...Object.keys(initialFiles), "/exports/rollout.json"].sort()),
  };
  return { passed: Object.values(checks).filter(Boolean).length, total: Object.keys(checks).length, checks };
}

export function expectedFiles() {
  return {
    ...initialFiles,
    "/policy/returns.md": initialFiles["/policy/returns.md"]
      .replace("EU customers: 30", "EU customers: 45")
      .replace("US customers: 14", "US customers: 30"),
    "/config/returns.json": JSON.stringify(expectedConfig),
    "/web/returns.html": initialFiles["/web/returns.html"]
      .replace("EU customers: 30", "EU customers: 45")
      .replace("US customers: 14", "US customers: 30"),
    "/exports/rollout.json": JSON.stringify(expectedConfig),
  };
}
