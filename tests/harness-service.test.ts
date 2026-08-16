import { describe, expect, it } from "vitest";
import { harnessLaunchArguments } from "../src/main/harness-service";

describe("HarnessService launch arguments", () => {
  it("exposes Node internals when Electron runs the Harness CLI", () => {
    expect(harnessLaunchArguments("C:\\managed\\dsh\\lib\\bin.js", 39084, true)).toEqual([
      "--expose-internals",
      "C:\\managed\\dsh\\lib\\bin.js",
      "web",
      "--host",
      "127.0.0.1",
      "--port",
      "39084",
    ]);
  });

  it("keeps the standard Node invocation unchanged", () => {
    expect(harnessLaunchArguments("C:\\checkout\\apps\\cli\\lib\\bin.js", 3080, false)).toEqual([
      "C:\\checkout\\apps\\cli\\lib\\bin.js",
      "web",
      "--host",
      "127.0.0.1",
      "--port",
      "3080",
    ]);
  });
});
