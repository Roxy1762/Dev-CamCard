import { describe, it, expect } from "vitest";
import { ENGINE_VERSION } from "../index";

describe("engine 骨架", () => {
  it("导出版本号", () => {
    expect(ENGINE_VERSION).toBe("0.0.1");
  });
});
