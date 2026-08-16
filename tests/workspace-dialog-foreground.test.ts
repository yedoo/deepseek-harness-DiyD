import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceDialogForegroundWatcher } from "../src/main/workspace-dialog-foreground";

describe("WorkspaceDialogForegroundWatcher", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("brings a workspace picker forward as soon as it appears", async () => {
    vi.useFakeTimers();
    const bringForward = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const watcher = new WorkspaceDialogForegroundWatcher(bringForward, {
      intervalMs: 100,
      timeoutMs: 1_000,
    });

    watcher.arm();
    await vi.advanceTimersByTimeAsync(100);

    expect(bringForward).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(bringForward).toHaveBeenCalledTimes(2);
  });

  it("stops looking after the short interaction window expires", async () => {
    vi.useFakeTimers();
    const bringForward = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    const watcher = new WorkspaceDialogForegroundWatcher(bringForward, {
      intervalMs: 100,
      timeoutMs: 250,
    });

    watcher.arm();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(bringForward).toHaveBeenCalledTimes(3);
  });
});
