import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Card } from "../../components/ui/Card";

describe("Card", () => {
  it("renders the legacy single-element API without glass classes", () => {
    const markup = renderToStaticMarkup(<Card data-testid="card">Content</Card>);

    expect(markup).toContain("<section");
    expect(markup).toContain("Content");
    expect(markup).not.toContain(["glass", "panel"].join("-"));
    expect(markup).toContain("bg-card");
  });
});
