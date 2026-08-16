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
        tone: "success",
      },
      harness: {
        name: "DeepSeek Harness",
        version: "rc.5 → rc.6",
        status: "发现新版本",
        action: { kind: "install-harness", label: "更新到 rc.6" },
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
      status: "下载完成，退出时也会安装",
      tone: "success",
      action: { kind: "install-desktop", label: "立即重启" },
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
      progress: 42,
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
    expect(presentation.desktop).toMatchObject({ status: "正在检查", busy: true });
    expect(presentation.harness).toMatchObject({ status: "正在检查", busy: true });
  });

  it("keeps the title icon static while showing Harness progress in its own row", () => {
    const presentation = presentUpdates({
      desktop: {
        phase: "up-to-date",
        currentVersion: "0.2.0",
        supported: true,
      },
      harness: {
        phase: "installing",
        currentVersion: "0.1.0-rc.5",
        version: "0.1.0-rc.6",
        stage: "verifying",
        supported: true,
      },
    });

    expect(presentation.icon).toBe("checking");
    expect(presentation.harness).toMatchObject({
      status: "正在校验新版本",
      busy: true,
    });
  });

  it("offers an in-app retry instead of an external Harness page after failure", () => {
    const presentation = presentUpdates({
      desktop: { phase: "up-to-date", currentVersion: "0.2.0", supported: true },
      harness: {
        phase: "error",
        currentVersion: "0.1.0-rc.5",
        version: "0.1.0-rc.6",
        operation: "install",
        message: "network reset",
        supported: true,
      },
    });

    expect(presentation.harness).toMatchObject({
      status: "更新失败，原版本仍可使用",
      details: "network reset",
      action: { kind: "install-harness", label: "重试更新" },
    });
  });

  it("offers an application restart after a Harness update is prepared", () => {
    const presentation = presentUpdates({
      desktop: { phase: "up-to-date", currentVersion: "0.2.1", supported: true },
      harness: {
        phase: "ready-to-restart",
        currentVersion: "0.1.0-rc.5",
        version: "0.1.0-rc.6",
        supported: true,
      },
    });

    expect(presentation.icon).toBe("ready");
    expect(presentation.harness).toEqual({
      name: "DeepSeek Harness",
      version: "rc.5 → rc.6",
      status: "已准备好，重启后生效",
      tone: "success",
      action: { kind: "restart-harness", label: "立即重启" },
    });
  });
});
