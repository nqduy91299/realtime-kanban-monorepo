import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  addCard,
  announcement,
  card,
  focusedHandle,
  handleIdOf,
  newBoardId,
  openAs,
  settled,
  titlesIn,
} from "./helpers.js";

async function boardWithCards(browser: Parameters<typeof openAs>[0]) {
  const board = newBoardId();
  const alice = await openAs(browser, "Alice", board);
  for (const title of ["One", "Two", "Three"]) await addCard(alice.page, "To do", title);
  await addCard(alice.page, "Doing", "Four");
  await settled(alice.page);
  alice.intentsSent.length = 0; // count only what the test does from here
  return { board, alice };
}

test("K1: Tab reaches a card handle; arrow keys move focus between cards like a grid", async ({ browser }) => {
  const { alice } = await boardWithCards(browser);
  const { page } = alice;
  const ids = {
    one: await handleIdOf(page, "One"),
    two: await handleIdOf(page, "Two"),
    four: await handleIdOf(page, "Four"),
  };

  await card(page, "One").getByRole("button", { name: "Move One" }).focus();
  await page.keyboard.press("ArrowDown");
  expect(await focusedHandle(page)).toBe(ids.two);
  await page.keyboard.press("ArrowRight"); // row 2 → Doing has one card → its only card
  expect(await focusedHandle(page)).toBe(ids.four);
  await page.keyboard.press("ArrowLeft");
  expect(await focusedHandle(page)).toBe(ids.one);
  expect(alice.intentsSent).toEqual([]); // moving focus changes nothing
  // The focused handle has a visible focus indicator.
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(outline).not.toBe("none");
});

test("K2–K5, K7: pick up, move with arrows (announced), drop = exactly one intent, focus stays", async ({ browser }) => {
  const { alice } = await boardWithCards(browser);
  const { page } = alice;
  const id = await handleIdOf(page, "One");
  const handle = card(page, "One").getByRole("button", { name: "Move One" });

  await handle.focus();
  await page.keyboard.press("Space");
  await expect(announcement(page)).toHaveText(
    "Picked up One. Position 1 of 3 in To do. Arrow keys to move, Space to drop, Escape to cancel.",
  );
  await expect(card(page, "One")).toHaveClass(/is-lifted/);

  await page.keyboard.press("ArrowDown");
  await expect(announcement(page)).toHaveText("Position 2 of 3 in To do.");
  await page.keyboard.press("ArrowRight");
  await expect(announcement(page)).toHaveText("Moved to Doing, position 2 of 2.");
  await page.keyboard.press("ArrowUp");
  await expect(announcement(page)).toHaveText("Position 1 of 2 in Doing.");
  expect(await focusedHandle(page)).toBe(id); // focus followed the card into another column
  expect(alice.intentsSent).toEqual([]); // nothing sent while moving (K5)

  await page.keyboard.press("Space");
  await expect(announcement(page)).toHaveText("Dropped One at position 1 of 2 in Doing.");
  expect(await titlesIn(page, "Doing")).toEqual(["One", "Four"]);
  await settled(page);
  expect(alice.intentsSent.map((i) => i.name)).toEqual(["moveCard"]); // three arrow presses, one intent
  expect(await focusedHandle(page)).toBe(id); // K7
});

test("K6: Escape puts the card back and sends nothing", async ({ browser }) => {
  const { alice } = await boardWithCards(browser);
  const { page } = alice;
  await card(page, "Two").getByRole("button", { name: "Move Two" }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  await expect(announcement(page)).toHaveText("Cancelled. Two returned to position 2 of 3 in To do.");
  expect(await titlesIn(page, "To do")).toEqual(["One", "Two", "Three"]);
  expect(alice.intentsSent).toEqual([]);
});

test("K8: columns reorder with the keyboard too", async ({ browser }) => {
  const { alice } = await boardWithCards(browser);
  const { page } = alice;
  await page.getByRole("button", { name: "Move column Done" }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Space");
  await expect(announcement(page)).toHaveText("Dropped column Done at position 1 of 3.");
  const order = await page.locator("section.column").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  expect(order).toEqual(["Column Done", "Column To do", "Column Doing"]);
});

test("K9 / P4: if someone deletes the card I'm dragging, the drag is cancelled and announced; they saw me moving it", async ({
  browser,
}) => {
  const { board, alice } = await boardWithCards(browser);
  const bob = await openAs(browser, "Bob", board);
  await alice.page.getByRole("button", { name: "Move Three" }).focus();
  await alice.page.keyboard.press("Space");

  await expect(card(bob.page, "Three").getByText("Alice is moving…")).toBeVisible(); // P4
  await card(bob.page, "Three").getByRole("button", { name: "Delete Three" }).click();

  await expect(announcement(alice.page)).toHaveText(/^Three was deleted by someone else\. Cancelled\./);
  await expect(alice.page.locator(".is-lifted")).toHaveCount(0);
  expect(alice.intentsSent).toEqual([]);
});

test("K10: when the server rejects a keyboard drop, the card returns and keeps focus", async ({ browser }) => {
  const { alice } = await boardWithCards(browser);
  const { page } = alice;
  const id = await handleIdOf(page, "One");
  await page.locator("summary", { hasText: "Dev panel" }).click();
  await page.getByRole("button", { name: "Reject next change" }).click();

  await card(page, "One").getByRole("button", { name: "Move One" }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");

  await expect(page.locator(".toast")).toHaveText(/Couldn't move “One”/);
  expect(await titlesIn(page, "To do")).toEqual(["One", "Two", "Three"]);
  await expect.poll(() => focusedHandle(page)).toBe(id);
});

test("K11: a mouse drag sends the same single intent", async ({ browser }) => {
  const { alice } = await boardWithCards(browser);
  const { page } = alice;
  const from = await card(page, "Two").getByRole("button", { name: "Move Two" }).boundingBox();
  const to = await page.locator('section.column[aria-label="Column Done"]').boundingBox();

  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  // Several intermediate moves, like a real hand.
  await page.mouse.move(to!.x + to!.width / 2, to!.y + 60, { steps: 12 });
  await expect(page.locator(".drag-overlay")).toHaveText("Two");
  await page.mouse.up();

  await expect.poll(() => titlesIn(page, "Done")).toEqual(["Two"]);
  await settled(page);
  expect(alice.intentsSent.map((i) => i.name)).toEqual(["moveCard"]);
});

test("K12: no accessibility violations (axe), at rest and while dragging", async ({ browser }) => {
  const { alice } = await boardWithCards(browser);
  const { page } = alice;
  const scan = () => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();

  const atRest = await scan();
  expect(atRest.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);

  await card(page, "One").getByRole("button", { name: "Move One" }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  const dragging = await scan();
  expect(dragging.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
  await page.keyboard.press("Escape");
});
