import { expect, type Browser, type Page } from "@playwright/test";

let counter = 0;
/** Every test gets its own board, so tests never see each other's cards. */
export function newBoardId(prefix = "e2e"): string {
  return `${prefix}-${process.pid}-${Date.now()}-${++counter}`;
}

export interface Person {
  page: Page;
  /** Every intent this page has sent over the WebSocket (to prove "one drag = one intent"). */
  intentsSent: { name: string; args: Record<string, unknown> }[];
  context: import("@playwright/test").BrowserContext;
  close(): Promise<void>;
}

/** A person = their own browser context (own storage, own presence), at their own window width. */
export async function openAs(
  browser: Browser,
  name: string,
  boardId: string,
  options: { width?: number; baseURL?: string; role?: "viewer"; colorScheme?: "light" | "dark" } = {},
): Promise<Person> {
  const context = await browser.newContext({
    viewport: { width: options.width ?? 1280, height: 800 },
    baseURL: options.baseURL ?? "http://localhost:5273",
    colorScheme: options.colorScheme ?? "light",
  });
  await context.addInitScript((n) => {
    try {
      localStorage.setItem("kanban:name", n);
    } catch {
      // Chrome's own offline error page has no storage
    }
  }, name);
  const page = await context.newPage();
  const intentsSent: Person["intentsSent"] = [];
  page.on("websocket", (ws) =>
    ws.on("framesent", (frame) => {
      const text = typeof frame.payload === "string" ? frame.payload : frame.payload.toString();
      if (text.includes('"t":"intent"')) intentsSent.push(JSON.parse(text));
    }),
  );
  page.on("pageerror", (error) => {
    throw new Error(`[${name}] page error: ${error.message}`);
  });
  await page.goto(`/?board=${boardId}${options.role ? `&role=${options.role}` : ""}`);
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  return { page, intentsSent, context, close: () => context.close() };
}

export const column = (page: Page, title: string) =>
  page.locator(`section.column[aria-label="Column ${title}"]`);

/**
 * A card, found by its drag handle's accessible name ("Move Fix bug"), which is what a screen reader
 * announces. (Not by `input[value=…]`: the title input is uncontrolled, so its text is a DOM property,
 * not an attribute.)
 */
export function card(page: Page, title: string) {
  return page
    .locator("li.card")
    .filter({ has: page.getByRole("button", { name: `Move ${title}`, exact: true }) });
}

export async function addCard(page: Page, columnTitle: string, title: string): Promise<void> {
  const input = column(page, columnTitle).getByPlaceholder("Add a card…");
  await input.fill(title);
  await input.press("Enter");
  await expect(card(page, title)).toBeVisible();
}

/** Card titles in a column, top to bottom. */
export function titlesIn(page: Page, columnTitle: string): Promise<string[]> {
  return column(page, columnTitle)
    .locator('input[aria-label="Card title"]')
    .evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value));
}

/** Wait until nothing on the page is still waiting for the server. */
export async function settled(page: Page): Promise<void> {
  await expect(page.getByText("Saving…")).toHaveCount(0);
}

/** The drag-and-drop screen reader announcement currently in the live region. */
export const announcement = (page: Page) => page.locator("#drag-announcer");

/** data-drag-handle of the element that has keyboard focus. */
export const focusedHandle = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.dragHandle ?? null);

/** A card by its id, for when its title is what the test is changing. */
export const cardById = (page: Page, id: string) => page.locator(`li.card[data-anchor="${id}"]`);

/** Wait until the app's service worker controls the page (production build only). */
export async function serviceWorkerReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) =>
        navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }),
      );
    }
  });
}

export async function handleIdOf(page: Page, title: string): Promise<string> {
  return (await card(page, title).locator("[data-drag-handle]").getAttribute("data-drag-handle"))!;
}
