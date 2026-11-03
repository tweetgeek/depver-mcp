import { describe, expect, it } from "vitest";
import { createLimiter } from "../../../src/core/limiter.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createLimiter", () => {
  it("never runs more than the limit concurrently for one key", async () => {
    const limiter = createLimiter();
    let inFlight = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, () => deferred<void>());
    const runs = gates.map((gate) =>
      limiter.run("npm", 2, async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await gate.promise;
        inFlight--;
      }),
    );
    await Promise.resolve();
    expect(inFlight).toBe(2);
    gates.forEach((g) => g.resolve());
    await Promise.all(runs);
    expect(peak).toBe(2);
  });

  it("treats keys independently", async () => {
    const limiter = createLimiter();
    let inFlight = 0;
    const gate = deferred<void>();
    const a = limiter.run("npm", 1, async () => {
      inFlight++;
      await gate.promise;
    });
    const b = limiter.run("pypi", 1, async () => {
      inFlight++;
      await gate.promise;
    });
    await Promise.resolve();
    expect(inFlight).toBe(2);
    gate.resolve();
    await Promise.all([a, b]);
  });

  it("releases the slot when a task rejects", async () => {
    const limiter = createLimiter();
    await expect(
      limiter.run("npm", 1, async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");
    await expect(limiter.run("npm", 1, async () => "next")).resolves.toBe("next");
  });

  it("starts queued tasks in FIFO order", async () => {
    const limiter = createLimiter();
    const order: number[] = [];
    const gate = deferred<void>();
    const first = limiter.run("k", 1, async () => {
      order.push(1);
      await gate.promise;
    });
    const second = limiter.run("k", 1, async () => {
      order.push(2);
    });
    const third = limiter.run("k", 1, async () => {
      order.push(3);
    });
    gate.resolve();
    await Promise.all([first, second, third]);
    expect(order).toEqual([1, 2, 3]);
  });
});
