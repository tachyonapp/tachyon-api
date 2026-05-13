import {
  FRAME_CONFIG,
  type BotFrameName,
} from "@tachyonapp/tachyon-queue-types";

const FRAMES = Object.keys(FRAME_CONFIG) as BotFrameName[];
const MARKET_AWARENESS_FIELDS = [
  "momentum",
  "meanReversion",
  "volatility",
  "trendFollowing",
] as const;

describe("FRAME_CONFIG", () => {
  describe("all frames have complete defaults", () => {
    it.each(FRAMES)("%s has all marketAwareness default fields", (frame) => {
      const { marketAwareness } = FRAME_CONFIG[frame].defaults;
      for (const field of MARKET_AWARENESS_FIELDS) {
        expect(marketAwareness).toHaveProperty(field);
        expect(typeof marketAwareness[field]).toBe("number");
      }
    });

    it.each(FRAMES)("%s has valid signal weights summing to 100", (frame) => {
      const { signalWeights } = FRAME_CONFIG[frame].defaults;
      const total =
        signalWeights.technicals + signalWeights.news + signalWeights.fundamentals;
      expect(total).toBe(100);
    });

    it.each(FRAMES)("%s has at least one advisory defined", (frame) => {
      expect(FRAME_CONFIG[frame].advisories.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("frame-specific default values", () => {
    it("GUARDIAN defaults to STAND_DOWN_BEAR regime awareness", () => {
      expect(FRAME_CONFIG.GUARDIAN.defaults.regimeAwareness).toBe(
        "STAND_DOWN_BEAR",
      );
    });

    it("BERSERKER defaults to INCREASE_AGGRESSION_BULL regime awareness", () => {
      expect(FRAME_CONFIG.BERSERKER.defaults.regimeAwareness).toBe(
        "INCREASE_AGGRESSION_BULL",
      );
    });

    it("SNIPER default dayAvoidance includes MONDAY", () => {
      expect(FRAME_CONFIG.SNIPER.defaults.dayAvoidance).toContain("MONDAY");
    });

    it("GUARDIAN defaults to PREFER_DIVIDEND dividend preference", () => {
      expect(FRAME_CONFIG.GUARDIAN.defaults.dividendPreference).toBe(
        "PREFER_DIVIDEND",
      );
    });

    it("BRAWLER defaults to EXCLUDE_DIVIDEND dividend preference", () => {
      expect(FRAME_CONFIG.BRAWLER.defaults.dividendPreference).toBe(
        "EXCLUDE_DIVIDEND",
      );
    });
  });
});
