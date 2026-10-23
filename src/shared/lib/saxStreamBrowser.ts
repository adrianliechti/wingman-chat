/**
 * Browser fallback for sax's optional Node Stream integration.
 *
 * sax only uses this constructor for its createStream API. Our browser code
 * uses sax.parser, so this mirrors sax's own fallback when `require("stream")`
 * is unavailable without bundling Node stream/event utilities.
 */
export function Stream(): void {
  // Intentionally empty: sax only needs a constructable function and prototype.
}
