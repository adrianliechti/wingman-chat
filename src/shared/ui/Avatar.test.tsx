import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { Avatar } from "./Avatar";

it("renders initials from first and last name tokens", () => {
  const html = renderToString(<Avatar name="Christian Meier" />);
  expect(html).toContain("CM");
});

it("renders a single initial for a one-word name", () => {
  const html = renderToString(<Avatar name="christian" />);
  expect(html).toContain("C");
});

it("collapses extra whitespace without producing empty initials", () => {
  const html = renderToString(<Avatar name="  Ada   Lovelace  " />);
  expect(html).toContain("AL");
});

it("falls back to a generic icon when no name is given", () => {
  const html = renderToString(<Avatar />);
  expect(html).toContain("<svg");
  expect(html).not.toMatch(/>[A-Z]{1,2}<\/span>/);
});
