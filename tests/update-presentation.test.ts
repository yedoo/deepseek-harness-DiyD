import { describe, expect, it } from "vitest";
import { presentUpdates } from "../src/preload/update-presentation";

describe("presentUpdates", () => {
  it("marks the title-bar icon and offers the Harness update when only Harness is newer", () => {
    const presentation = presentUpdates({
      desktop: {
        phase: "up-to-date",
        currentVersion: "0.1.4",
        supported: true,
      },
      harness: {
        phase: "available",
        currentVersion: "0.1.0-rc.5",
        version: "0.1.0-rc.6",
        supported: true,
      },
    });

    expect(presentation).toEqual({
      icon: "available",
      desktop: {
        name: "桌面客户端",
        version: "v0.1.4",
        status: "已是最新",
      },
      harness: {
        name: "DeepSeek Harness",
        version: "rc.5 → rc.6",
        status: "发现新版本",
        action: { kind: "show-harness", label: "查看更新" },
      },
    });
  });

  it("turns the icon ready and offers restart after a desktop update downloads", () => {
    const presentation = presentUpdates({
      desktop: {
        phase: "downloaded",
        currentVersion: "0.1.3",
        version: "0.1.4",
        supported: true,
      },
      harness: {
        phase: "up-to-date",
        currentVersion: "0.1.0-rc.6",
        supported: true,
      },
    });

    expect(presentation.icon).toBe("ready");
    expect(presentation.desktop).toEqual({
      name: "桌面客户端",
      version: "v0.1.3 → v0.1.4",
      status: "下载完成",
      action: { kind: "install-desktop", label: "重启更新" },
    });
    expect(presentation.harness.status).toBe("已是最新");
  });

  it("offers an in-app download when a desktop release is available", () => {
    const presentation = presentUpdates({
      desktop: {
        phase: "available",
        currentVersion: "0.1.3",
        version: "0.1.4",
        supported: true,
      },
      harness: {
        phase: "idle",
        currentVersion: "0.1.0-rc.5",
        supported: true,
      },
    });

    expect(presentation.icon).toBe("available");
    expect(presentation.desktop).toEqual({
      name: "桌面客户端",
      version: "v0.1.3 → v0.1.4",
      status: "发现新版本",
      action: { kind: "download-desktop", label: "下载更新" },
    });
  });

  it("shows desktop download progress without offering a second action", () => {
    const presentation = presentUpdates({
      desktop: {
        phase: "downloading",
        currentVersion: "0.1.3",
        version: "0.1.4",
        percent: 42,
        supported: true,
      },
      harness: {
        phase: "idle",
        currentVersion: "0.1.0-rc.5",
        supported: true,
      },
    });

    expect(presentation.icon).toBe("downloading");
    expect(presentation.desktop).toEqual({
      name: "桌面客户端",
      version: "v0.1.3 → v0.1.4",
      status: "正在下载 42%",
    });
  });

  it("shows a neutral checking state without an update dot", () => {
    const presentation = presentUpdates({
      desktop: {
        phase: "checking",
        currentVersion: "0.1.4",
        supported: true,
      },
      harness: {
        phase: "checking",
        currentVersion: "0.1.0-rc.5",
        supported: true,
      },
    });

    expect(presentation.icon).toBe("checking");
    expect(presentation.desktop.status).toBe("正在检查…");
    expect(presentation.harness.status).toBe("正在检查…");
  });
});
