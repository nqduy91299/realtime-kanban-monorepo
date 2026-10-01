import { expect, test } from "@playwright/test";
import { addCard, card, newBoardId, openAs, settled, titlesIn } from "./helpers.js";

test("O1/O2: with a slow network the card moves at once and shows Saving… until the server answers", async ({
  browser,
}) => {
  const board = newBoardId();
  const alice = await openAs(browser, "Alice", board);
  const bob = await openAs(browser, "Bob", board);
  await addCard(alice.page, "To do", "Write docs");
  await settled(alice.page);

  await alice.page.locator("summary", { hasText: "Dev panel" }).click();
  await alice.page.locator("#dev-latency").fill("1500");

  // Keyboard drag: one step right, drop.
  const handle = card(alice.page, "Write docs").getByRole("button", { name: "Move Write docs" });
  await handle.focus();
  await handle.press("Space");
  await handle.press("ArrowRight");
  await alice.page.keyboard.press("Space");

  // Immediately: moved, marked as saving, and nobody else has it yet.
  expect(await titlesIn(alice.page, "Doing")).toEqual(["Write docs"]);
  await expect(card(alice.page, "Write docs")).toHaveClass(/is-pending/);
  await expect(card(alice.page, "Write docs").getByText("Saving…")).toBeVisible();
  expect(await titlesIn(bob.page, "Doing")).toEqual([]);

  // Then: confirmed, marker gone, and Bob sees it.
  await expect(card(alice.page, "Write docs").getByText("Saving…")).toBeHidden({ timeout: 6000 });
  await expect.poll(() => titlesIn(bob.page, "Doing")).toEqual(["Write docs"]);
});

test("O4/O8: a change the server rejects snaps back with a toast, and the card flashes", async ({
  browser,
}) => {
  const alice = await openAs(browser, "Alice", newBoardId());
  const { page } = alice;
  await addCard(page, "To do", "Fix bug");
  await settled(page);

  await page.locator("summary", { hasText: "Dev panel" }).click();
  await page.getByRole("button", { name: "Reject next change" }).click();

  const handle = card(page, "Fix bug").getByRole("button", { name: "Move Fix bug" });
  await handle.focus();
  await handle.press("Space");
  await handle.press("ArrowRight");
  await page.keyboard.press("Space");

  await expect(page.locator(".toast")).toHaveText(/Couldn't move “Fix bug”: the dev panel rejected it/);
  expect(await titlesIn(page, "To do")).toEqual(["Fix bug"]);
  await expect(card(page, "Fix bug")).toHaveClass(/is-rolled-back/);
  // The toast container is a polite live region, so screen readers hear it too.
  await expect(page.locator(".toasts")).toHaveAttribute("role", "status");
});

test("R3: a move into a full column is refused on the spot with the reason", async ({ browser }) => {
  const { page } = await openAs(browser, "Alice", newBoardId());
  await page.locator("#wip-doing").fill("1");
  await page.locator("#wip-doing").press("Enter");
  await addCard(page, "Doing", "Already here");
  await addCard(page, "To do", "Wants in");

  const handle = card(page, "Wants in").getByRole("button", { name: "Move Wants in" });
  await handle.focus();
  await handle.press("Space");
  await handle.press("ArrowRight");
  await page.keyboard.press("Space");

  await expect(page.locator(".toast").last()).toHaveText(/“Doing” is full \(limit 1\)/);
  expect(await titlesIn(page, "To do")).toEqual(["Wants in"]);
});
