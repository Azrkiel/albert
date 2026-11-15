import { expect, test } from "@playwright/test";

test("P5.7-AC1: Canvas, Moodle and Blackboard are plain coming-soon names under the import button", async ({ page }) => {
  await page.route("**/api/source/courses", route => route.fulfill({ json: [] }));
  await page.goto("/");
  const importButton = page.getByRole("button", { name: "Import course", exact: true });
  const list = page.getByTestId("coming-soon-sources");
  await expect(list.getByRole("listitem")).toHaveCount(3);
  for (const [i, name] of ["Canvas", "Moodle", "Blackboard"].entries()) {
    const item = list.getByRole("listitem").nth(i);
    await expect(item).toContainText(name);
    await expect(item).toContainText("coming soon");
  }
  // Names only: no links, buttons or images inside the list.
  await expect(list.locator("a, button, img, svg, input")).toHaveCount(0);
  // Placed below the import button.
  const [b, l] = await Promise.all([importButton.boundingBox(), list.boundingBox()]);
  expect(l!.y).toBeGreaterThan(b!.y + b!.height);
  // Not clickable: clicking changes nothing.
  await list.getByRole("listitem").first().click();
  await expect(page).toHaveURL(/\/$/);
});
