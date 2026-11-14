import { expect, test } from "@playwright/test";
import type { HintEvent } from "../../src/lib/contracts";

for (const outcome of ["success", "timeout"] as const) {
  test(`manual hint immediately shows pending feedback, then ${outcome}, while writing stays usable`, async ({ page }) => {
    let releaseResponse!: () => void;
    const holdResponse = () => new Promise<void>((resolve) => { releaseResponse = resolve; });
    let responseGate = holdResponse();
    const events: HintEvent[] = outcome === "timeout"
      ? [{ type: "error", code: "timeout", message: "Private transport detail" }]
      : [
        { type: "started", hintId: "pending-test", at: 0 },
        { type: "hint", kind: "question", segments: [{ type: "text", text: "Which step comes next?" }] },
        { type: "done", hintId: "pending-test", ms: { firstEvent: 10, total: 20 } },
      ];
    await page.route("**/api/hint", async (route) => {
      await responseGate;
      await route.fulfill({ contentType: "application/x-ndjson", body: events.map(event => JSON.stringify(event)).join("\n") + "\n" });
    });
    await page.goto("/work/calc2-ws3?layout=ruled");
    await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(2);
    const problem = page.locator('section[data-problem-id="calc2-ws3/p1"]');
    const button = problem.getByRole("button", { name: "I'm stuck", exact: true });
    const column = problem.locator("[data-albert-column]");
    await button.click();
    try {
      await expect(column).toHaveText("Getting a hint...", { timeout: 2000 });
      await expect(button).toBeDisabled();
      await expect(page.locator('section[data-problem-id="calc2-ws3/p2"] [data-albert-column]')).toBeEmpty();

      const surface = problem.locator("svg[data-capture-ready=true]");
      await surface.scrollIntoViewIfNeeded();
      const [from, to] = await surface.evaluate(svg => [[120, 150], [160, 170]].map(([x, y]) => {
        const point = new DOMPoint(x, y).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
        return { x: point.x, y: point.y };
      }));
      await page.mouse.move(from!.x, from!.y);
      await page.mouse.down();
      await page.mouse.move(to!.x, to!.y, { steps: 6 });
      await page.mouse.up();
      await expect(problem.locator("path[data-stroke-id]")).toHaveCount(1);
    } finally { releaseResponse(); }

    const finalText = outcome === "timeout" ? "That took too long. Try again?" : "Which step comes next?";
    await expect(column).toHaveText(finalText);
    await expect(button).toBeEnabled();
    await expect(problem.locator("path[data-stroke-id]")).toHaveCount(1);

    if (outcome === "timeout") {
      responseGate = holdResponse();
      await button.click();
      try { await expect(column).toHaveText("Getting a hint...", { timeout: 2000 }); }
      finally { releaseResponse(); }
      await expect(column).toHaveText(finalText);
      await expect(button).toBeEnabled();
    }
  });
}
