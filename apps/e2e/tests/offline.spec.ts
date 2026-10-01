import { expect, test } from "@playwright/test";
import { addCard, card, newBoardId, openAs, serviceWorkerReady, titlesIn } from "./helpers.js";

test("F1/F2: losing the network shows the banner within 2 s; work continues and syncs when back", async ({
  browser,
}) => {
  const board = newBoardId();
  const alice = await openAs(browser, "Alice", board);
  const bob = await openAs(browser, "Bob", board);

  await alice.context.setOffline(true); // fires the browser's "offline" event
  const banner = alice.page.getByText("Offline: changes are saved on this device.");
  await expect(banner).toBeVisible({ timeout: 2000 });

  await addCard(alice.page, "To do", "Written offline");
  await expect(alice.page.locator(".offline-banner")).toContainText("1 change will sync");
  await expect(card(bob.page, "Written offline")).toHaveCount(0);

  await alice.context.setOffline(false);
  await expect(banner).toBeHidden();
  await expect.poll(() => titlesIn(bob.page, "To do")).toEqual(["Written offline"]);
});

test("F3: with the production build, a reload with no network at all still shows the board", async ({ browser }) => {
  const board = newBoardId();
  const alice = await openAs(browser, "Alice", board, { baseURL: "http://localhost:4273" });
  await addCard(alice.page, "To do", "Survives");
  // The service worker has to be installed and controlling the page before we cut the network.
  await serviceWorkerReady(alice.page);
  await alice.page.reload(); // let the worker cache the page and its assets
  await expect(alice.page.getByText("Connected", { exact: true })).toBeVisible();

  await alice.context.setOffline(true);
  await addCard(alice.page, "Doing", "Added offline");
  await alice.page.reload();

  await expect(alice.page.getByText("Offline: changes are saved on this device.")).toBeVisible();
  expect(await titlesIn(alice.page, "To do")).toEqual(["Survives"]);
  expect(await titlesIn(alice.page, "Doing")).toEqual(["Added offline"]);
  await expect(card(alice.page, "Added offline").getByText("Saving…")).toBeVisible(); // still pending

  await alice.context.setOffline(false);
  await expect(card(alice.page, "Added offline").getByText("Saving…")).toBeHidden({ timeout: 10_000 });
});

test("F9: a board never opened on this device isn't available offline", async ({ browser }) => {
  // The app itself must load with no network, so this needs the service worker (production build).
  const alice = await openAs(browser, "Alice", newBoardId(), { baseURL: "http://localhost:4273" });
  await serviceWorkerReady(alice.page);
  await alice.page.reload();
  await alice.context.setOffline(true);
  await alice.page.goto(`/?board=${newBoardId("never-seen")}`);
  await expect(alice.page.getByRole("heading", { name: "This board isn't available offline" })).toBeVisible();
});
