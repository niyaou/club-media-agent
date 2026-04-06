import { describe, expect, it } from "vitest";

import { withNavigationRetry } from "../src/site/rednote/page-stability.js";

describe("withNavigationRetry", () => {
  it("retries when the execution context is destroyed by navigation", async () => {
    let attempts = 0;
    let settledCalls = 0;

    const result = await withNavigationRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("locator.evaluateAll: Execution context was destroyed, most likely because of a navigation");
        }

        return ["ok"];
      },
      async () => {
        settledCalls += 1;
      }
    );

    expect(result).toEqual(["ok"]);
    expect(attempts).toBe(2);
    expect(settledCalls).toBe(1);
  });

  it("does not hide unrelated errors", async () => {
    await expect(
      withNavigationRetry(
        async () => {
          throw new Error("selector not found");
        },
        async () => {}
      )
    ).rejects.toThrow("selector not found");
  });
});
