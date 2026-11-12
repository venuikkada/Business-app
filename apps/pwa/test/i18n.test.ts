import { describe, expect, it } from "vitest";
import en from "../src/i18n/en.json";
import hi from "../src/i18n/hi.json";
import te from "../src/i18n/te.json";
import hinglish from "../src/i18n/hinglish.json";

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("translations", () => {
  for (const [name, dict] of Object.entries({ hi, te, hinglish })) {
    it(`${name} has every English key, no extras, same {placeholders}, nothing empty`, () => {
      const d = dict as Record<string, string>;
      expect(Object.keys(d).sort()).toEqual(Object.keys(en).sort());
      for (const [k, v] of Object.entries(en)) {
        expect(d[k]!.trim().length, k).toBeGreaterThan(0);
        expect(vars(d[k]!), k).toEqual(vars(v));
      }
    });
  }
});
