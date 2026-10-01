import { expect, test } from "@playwright/test";
import { addCard, cardById, handleIdOf, newBoardId, openAs, settled, titlesIn } from "./helpers.js";

test("U1/U7: a whole keyboard drag is one undo step; shortcut and toolbar both work; redo too", async ({
  browser,
}) => {
  const { page } = await openAs(browser, "Alice", newBoardId());
  await addCard(page, "To do", "Task");
  await settled(page);

  await page.getByRole("button", { name: "Move Task" }).focus();
  await page.keyboard.press("Space");
  for (const key of ["ArrowRight", "ArrowRight", "ArrowLeft"]) await page.keyboard.press(key);
  await page.keyboard.press("Space");
  expect(await titlesIn(page, "Doing")).toEqual(["Task"]);
  await settled(page);

  await page.keyboard.press("ControlOrMeta+z"); // focus is on the handle, not a text field → board undo
  await expect(page.locator(".toast").last()).toHaveText("Undone: move “Task”.");
  expect(await titlesIn(page, "To do")).toEqual(["Task"]); // straight back: one step for the whole drag

  await page.getByRole("button", { name: "↷ Redo" }).click();
  await expect.poll(() => titlesIn(page, "Doing")).toEqual(["Task"]);
});

test("U5: Cmd/Ctrl+Z inside a title undoes my typing there, not the board and not the other person's typing", async ({
  browser,
}) => {
  const board = newBoardId();
  const alice = await openAs(browser, "Alice", board);
  const bob = await openAs(browser, "Bob", board);
  await addCard(alice.page, "To do", "Fix bug");
  await settled(alice.page);

  // By id: the titles are exactly what this test changes.
  const id = await handleIdOf(alice.page, "Fix bug");
  const aliceTitle = cardById(alice.page, id).getByLabel("Card title");
  const bobTitle = cardById(bob.page, id).getByLabel("Card title");
  await aliceTitle.click();
  await aliceTitle.press("End");
  await aliceTitle.pressSequentially(" now");
  await expect(bobTitle).toHaveValue("Fix bug now");

  await bobTitle.click();
  await bobTitle.press("Home");
  await bobTitle.pressSequentially("Urgent: ");
  await expect(aliceTitle).toHaveValue("Urgent: Fix bug now");

  await aliceTitle.press("ControlOrMeta+z");
  await expect(aliceTitle).toHaveValue("Urgent: Fix bug"); // my " now" is gone, Bob's words stay
  await expect(bobTitle).toHaveValue("Urgent: Fix bug");
  expect(await titlesIn(alice.page, "To do")).toEqual(["Urgent: Fix bug"]); // the card itself didn't move
  await aliceTitle.press("ControlOrMeta+Shift+z");
  await expect(aliceTitle).toHaveValue("Urgent: Fix bug now");
});

test("U4: undo is refused if someone moved the card after me", async ({ browser }) => {
  const board = newBoardId();
  const alice = await openAs(browser, "Alice", board);
  const bob = await openAs(browser, "Bob", board);
  await addCard(alice.page, "To do", "Contested");
  await settled(alice.page);

  const drag = async (page: typeof alice.page, keys: string[]) => {
    await page.getByRole("button", { name: "Move Contested" }).focus();
    await page.keyboard.press("Space");
    for (const key of keys) await page.keyboard.press(key);
    await page.keyboard.press("Space");
    await settled(page);
  };
  await drag(alice.page, ["ArrowRight"]); // Alice: To do → Doing
  await expect.poll(() => titlesIn(bob.page, "Doing")).toEqual(["Contested"]);
  await drag(bob.page, ["ArrowRight"]); // Bob: Doing → Done
  await expect.poll(() => titlesIn(alice.page, "Done")).toEqual(["Contested"]);

  await alice.page.getByRole("button", { name: "↶ Undo" }).click();
  await expect(alice.page.locator(".toast").last()).toHaveText(
    "Couldn't undo: someone changed “Contested” after you.",
  );
  expect(await titlesIn(alice.page, "Done")).toEqual(["Contested"]);
});
