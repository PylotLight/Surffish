import { describe, expect, test } from "bun:test";
import {
  searchTimeZones,
  WORLD_CITIES,
  isSupportedTimeZone,
} from "./world-cities";

const zones = Intl.supportedValuesOf("timeZone");

describe("world city time zone search", () => {
  test("finds US cities that IANA does not name", () => {
    expect(searchTimeZones("tampa", zones)[0]).toMatchObject({
      city: "Tampa",
      timeZone: "America/New_York",
    });
    expect(searchTimeZones("seattle", zones)[0]).toMatchObject({
      city: "Seattle",
      timeZone: "America/Los_Angeles",
    });
  });
  test("matches by state / region", () => {
    const florida = searchTimeZones("florida", zones).map((r) => r.city);
    expect(florida).toContain("Tampa");
    expect(florida).toContain("Miami");
  });
  test("still finds raw IANA zones", () => {
    expect(
      searchTimeZones("Asia/Kolkata", zones).some(
        (r) => r.timeZone === "Asia/Kolkata",
      ),
    ).toBe(true);
  });
  test("accent-insensitive", () => {
    expect(searchTimeZones("sao paulo", zones)[0]?.timeZone).toBe(
      "America/Sao_Paulo",
    );
  });
  test("every curated zone used is either supported or skipped", () => {
    for (const city of WORLD_CITIES) {
      if (!isSupportedTimeZone(city.timeZone))
        expect(
          searchTimeZones(city.city, zones).some(
            (r) => r.key.startsWith("city:") && r.city === city.city,
          ),
        ).toBe(false);
    }
  });
});
