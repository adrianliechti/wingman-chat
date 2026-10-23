export function countSchemaUnions(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value)) return value.reduce((total, item) => total + countSchemaUnions(item), 0);

  const schema = value as Record<string, unknown>;
  const here = Array.isArray(schema.type) || Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf) ? 1 : 0;
  return here + Object.values(schema).reduce<number>((total, item) => total + countSchemaUnions(item), 0);
}
