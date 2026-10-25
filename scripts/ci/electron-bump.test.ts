import { describe, expect, test } from "bun:test";
import { pickTarget } from "./electron-bump";

const pub = [
  "44.7.1",
  "44.7.2",
  "45.0.0-alpha.16",
  "45.0.0-beta.2",
  "45.0.0-beta.3",
  "46.0.0-nightly.20261014",
];

describe("electron bump policy", () => {
  test("beta: newer beta of the current major", () => {
    expect(pickTarget("45.0.0-beta.2", pub, "beta")).toBe("45.0.0-beta.3");
    expect(pickTarget("45.0.0-beta.3", pub, "beta")).toBeNull();
  });
  test("alpha pin: selects a newer beta, never an alpha or nightly", () => {
    const p = [...pub, "46.0.0-alpha.2", "46.0.0-beta.1", "47.0.0-alpha.1"];
    expect(pickTarget("46.0.0-alpha.1", p, "beta")).toBe("46.0.0-beta.1");
    expect(pickTarget("46.0.0-alpha.1", ["46.0.0-alpha.2"], "beta")).toBeNull();
  });
  test("alpha pin: stable-after-ga allows beta before GA; stable waits for GA", () => {
    const preGa = ["46.0.0-alpha.2", "46.0.0-beta.1"];
    expect(pickTarget("46.0.0-alpha.1", preGa, "stable-after-ga")).toBe(
      "46.0.0-beta.1",
    );
    expect(pickTarget("46.0.0-alpha.1", [...preGa, "46.0.0"], "stable")).toBe(
      "46.0.0",
    );
  });
  test("beta: moves from 44 stable to the 45 beta, never alpha or nightly", () => {
    expect(pickTarget("44.7.2", pub, "beta")).toBe("45.0.0-beta.3");
  });
  test("beta: GA, its patches, then the next beta", () => {
    const p = [...pub, "45.0.0", "45.0.1"];
    expect(pickTarget("45.0.0-beta.3", p, "beta")).toBe("45.0.1");
    expect(pickTarget("45.0.1", [...p, "46.0.0-beta.1"], "beta")).toBe(
      "46.0.0-beta.1",
    );
  });
  test("stable-after-ga: betas until GA, then stable patches only", () => {
    const p = [...pub, "45.0.0", "45.0.1", "46.0.0-beta.1"];
    expect(pickTarget("45.0.0-beta.2", pub, "stable-after-ga")).toBe(
      "45.0.0-beta.3",
    );
    expect(pickTarget("45.0.0-beta.3", p, "stable-after-ga")).toBe("45.0.1");
    expect(pickTarget("45.0.1", p, "stable-after-ga")).toBeNull();
    expect(pickTarget("45.0.1", [...p, "46.0.0"], "stable-after-ga")).toBe(
      "46.0.0",
    );
  });
  test("stable: never a beta", () => {
    expect(pickTarget("44.7.1", pub, "stable")).toBe("44.7.2");
    expect(pickTarget("45.0.0-beta.3", pub, "stable")).toBeNull();
    expect(pickTarget("45.0.0-beta.3", [...pub, "45.0.0"], "stable")).toBe(
      "45.0.0",
    );
  });
  test("rejects a range pin", () => {
    expect(() => pickTarget("^45.0.0", pub, "beta")).toThrow();
  });
});
