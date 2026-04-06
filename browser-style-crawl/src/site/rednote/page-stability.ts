import type { Page } from "playwright";

const NAVIGATION_RETRY_MESSAGES = [
  "Execution context was destroyed",
  "Cannot find context with specified id",
  "Target closed"
];

function isTransientNavigationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return NAVIGATION_RETRY_MESSAGES.some((message) => error.message.includes(message));
}

export async function waitForPageStability(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(750);
}

export async function withNavigationRetry<T>(
  operation: () => Promise<T>,
  settlePage: () => Promise<void>,
  maxAttempts = 3
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientNavigationError(error) || attempt === maxAttempts) {
        throw error;
      }

      await settlePage();
    }
  }

  throw lastError;
}
