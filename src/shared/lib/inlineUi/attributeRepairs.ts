import { A2uiValidationError } from "@a2ui/web_core/v1_0";
import { z } from "zod-a2ui";
import { basicCatalog, wingmanCatalog, WINGMAN_CATALOG_ID } from "./catalog.ts";
import { REFERENCE_GROUPS } from "./registry.ts";

const unknownKeysIssue = z.object({
  code: z.literal("unrecognized_keys"),
  path: z.array(z.union([z.string(), z.number()])),
  keys: z.array(z.string()),
});

// Derive suggestions from the registered schemas, including future attributes.
type ComponentOwner = { component: string; catalog: string; reference: string };
const propertyOwners = new Map<string, ComponentOwner[]>();
const componentOwners = new Map<string, ComponentOwner[]>();
for (const [key, catalog] of [
  ["basic", basicCatalog],
  ["wingman", wingmanCatalog],
] as const) {
  const schemas = catalog.catalogSchema.components as Record<string, { properties: Record<string, unknown> }>;
  for (const [component, schema] of Object.entries(schemas)) {
    const reference = Object.values(REFERENCE_GROUPS).find((group) =>
      group[key]?.components?.includes(component),
    )!.path;
    const owner = { component, catalog: catalog.id, reference };
    const components = componentOwners.get(component) ?? [];
    components.push(owner);
    componentOwners.set(component, components);
    for (const property of Object.keys(schema.properties)) {
      const owners = propertyOwners.get(property) ?? [];
      owners.push(owner);
      propertyOwners.set(property, owners);
    }
  }
}

/** Explain strict schema failures without rewriting UI or relaxing validation. */
export function attributeRepairHints(error: unknown): string[] {
  if (!(error instanceof A2uiValidationError)) return [];
  const unknownComponent = error.message.match(/^Unknown component type '([^']+)' not found in catalog '([^']+)'\.$/);
  if (unknownComponent) {
    const [, component, catalog] = unknownComponent;
    const owners = componentOwners.get(component) ?? [];
    return owners
      .filter((owner) => owner.catalog !== catalog)
      .map(
        (owner) =>
          `Catalog repair: ${component} requires catalogId "${owner.catalog}" on this component. Components without catalogId inherit the surface's default catalog, not a parent or sibling's catalog. Keep each component in its registered catalog. Read inline-ui ${owner.reference}.`,
      );
  }
  const details: unknown = error.details;
  if (!Array.isArray(details)) return [];
  const component = error.message.match(/Validation failed for component '([^']+)'/)?.[1];
  if (!component) return [];
  const properties = new Set<string>();
  for (const detail of details) {
    const parsed = unknownKeysIssue.safeParse(detail);
    // A nested Table column or metadata field is not a component-level prop.
    if (parsed.success && parsed.data.path.length === 0) for (const key of parsed.data.keys) properties.add(key);
  }
  return [...properties].slice(0, 5).map((property) => {
    if (property === "visible")
      return `Visibility repair: Basic components such as Text, Row and Column do not accept visible. Move visible to a wrapping Grid with catalogId "${WINGMAN_CATALOG_ID}" and children containing the Basic component's ID. Remove visible from the Basic component; keep its catalog unchanged. Read inline-ui references/layout.md for a complete example.`;
    if (property === "disabled")
      return "Disabled repair: Basic components do not accept disabled. Use a matching Wingman control where available, or omit disabled. A Grid wrapper does not disable its Basic descendants. Read inline-ui references/controls.md.";
    if (component === "Slider" && property === "step")
      return `Slider.step repair: Basic Slider uses steps, an integer number of intervals; the increment is (max - min) / steps. Wingman Stepper.step is a numeric increment and requires catalogId "${WINGMAN_CATALOG_ID}". Read inline-ui references/controls.md.`;
    if (component === "Button" && property === "label")
      return "Button.label repair: Basic Button uses child pointing to a Text component, rather than label. Form.submit is a Wingman property. Read inline-ui references/controls.md.";
    if (
      property === "description" &&
      ["Button", "TextField", "CheckBox", "ChoicePicker", "Slider", "DateTimeInput"].includes(component)
    )
      return "Description repair: description is not a shared Basic property. Use a separate Text for helper text on Basic controls; Wingman controls support description. Read inline-ui references/controls.md.";
    const owners = propertyOwners.get(property);
    if (!owners)
      return `Attribute repair: ${component}.${property} is unsupported by every registered component. Remove it and use only documented properties; CSS props such as style, className, padding and fontSize are not accepted.`;
    const targets = owners.map((owner) => `${owner.component} (catalogId "${owner.catalog}")`).join(", ");
    const references = [...new Set(owners.map((owner) => owner.reference))].join(", ");
    return `Attribute repair: ${component}.${property} is unsupported. ${property} is accepted by ${targets}. Use the documented component and value type instead of copying props between components. Read inline-ui ${references}.`;
  });
}
