import { describe, expect, it } from "vitest";
import { licenceAllowed } from "./licence";

describe("licenceAllowed", () => {
  it("accepts CC0, public domain and CC BY", () => {
    for (const s of ["CC0", "CC0 1.0", "Public domain", "PDM-owner", "CC BY 2.0", "CC BY 4.0", "CC-BY-3.0", "CC BY 3.0 DE"]) {
      expect(licenceAllowed(s), s).toBe(true);
    }
  });
  it("rejects ShareAlike, NonCommercial, NoDerivs, unknown and empty", () => {
    for (const s of ["CC BY-SA 4.0", "CC BY-SA 3.0", "CC BY-NC 2.0", "CC BY-ND 4.0", "CC BY-NC-SA 2.0", "GFDL", "Fair use", ""]) {
      expect(licenceAllowed(s), s).toBe(false);
    }
  });
});
