import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { addCard, card, newBoardId, openAs } from "./helpers.js";

test("P1: each person sees the other's avatar, never their own", async ({ browser }) => {
  const board = newBoardId();
  const alice = await openAs(browser, "Alice Otter", board);
  const bob = await openAs(browser, "Bob Falcon", board);
  await expect(alice.page.locator('.avatars li[title="Bob Falcon"]')).toBeVisible();
  await expect(bob.page.locator('.avatars li[title="Alice Otter"]')).toBeVisible();
  await expect(alice.page.locator('.avatars li[title="Alice Otter"]')).toHaveCount(0);
});

test("P2: a cursor lands on the same card in a narrower window", async ({ browser }) => {
  const board = newBoardId();
  const alice = await openAs(browser, "Alice", board, { width: 1300 });
  const bob = await openAs(browser, "Bob", board, { width: 760 }); // columns wrap differently
  await addCard(alice.page, "Done", "Target");
  await expect(card(bob.page, "Target")).toBeVisible();

  const aliceCard = (await card(alice.page, "Target").boundingBox())!;
  const bobCard = (await card(bob.page, "Target").boundingBox())!;
  expect(Math.round(aliceCard.x)).not.toBe(Math.round(bobCard.x)); // the layouts really differ

  await alice.page.mouse.move(aliceCard.x + aliceCard.width * 0.75, aliceCard.y + aliceCard.height * 0.5, { steps: 4 });
  const cursor = bob.page.locator(".cursor").filter({ hasText: "Alice" });
  await expect(cursor).toBeVisible();
  await expect
    .poll(async () => {
      const tip = await cursor.locator("svg").boundingBox();
      return (
        !!tip &&
        tip.x >= bobCard.x &&
        tip.x <= bobCard.x + bobCard.width &&
        tip.y >= bobCard.y &&
        tip.y <= bobCard.y + bobCard.height
      );
    })
    .toBe(true);
});

test("P3: focusing a card shows my color ring and name on the other screen", async ({ browser }) => {
  const board = newBoardId();
  const alice = await openAs(browser, "Alice", board);
  const bob = await openAs(browser, "Bob", board);
  await addCard(alice.page, "To do", "Look here");
  await card(alice.page, "Look here").getByLabel("Card title").click();
  const seen = card(bob.page, "Look here");
  await expect(seen).toHaveClass(/has-peer/);
  await expect(seen.locator(".peer-tag")).toHaveText("Alice");
});

test("P5: closing a tab removes that person at once", async ({ browser }) => {
  const board = newBoardId();
  const alice = await openAs(browser, "Alice", board);
  const bob = await openAs(browser, "Bob", board);
  await expect(alice.page.locator('.avatars li[title="Bob"]')).toBeVisible();
  await bob.close();
  await expect(alice.page.locator('.avatars li[title="Bob"]')).toHaveCount(0, { timeout: 2000 });
});

test("K12 (dark mode): no accessibility violations with the dark palette", async ({ browser }) => {
  const board = newBoardId();
  const alice = await openAs(browser, "Alice", board, { colorScheme: "dark" });
  await openAs(browser, "Bob", board);
  await addCard(alice.page, "To do", "Dark card");
  await expect(alice.page.locator('.avatars li[title="Bob"]')).toBeVisible();
  const result = await new AxeBuilder({ page: alice.page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
});
