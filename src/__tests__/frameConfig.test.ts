import { FRAME_CONFIG, type BotFrameName } from "../config/frameConfig";

const FRAMES = Object.keys(FRAME_CONFIG) as BotFrameName[];
const MARKET_AWARENESS_FIELDS = ["momentum", "meanReversion", "volatility", "trendFollowing"] as const;

describe("FRAME_CONFIG", () => {
  describe("all frames have correct marketAwareness bound fields", () => {
    it.each(FRAMES)("%s has all 4 marketAwareness bound fields", (frame) => {
      const { marketAwareness } = FRAME_CONFIG[frame].bounds;
      for (const field of MARKET_AWARENESS_FIELDS) {
        expect(marketAwareness).toHaveProperty(field);
        expect(typeof marketAwareness[field].min).toBe("number");
        expect(typeof marketAwareness[field].max).toBe("number");
      }
    });
  });

  describe("frame-specific riskAttitude exclusions", () => {
    it("GUARDIAN excludes AGGRESSIVE riskAttitude", () => {
      expect(FRAME_CONFIG.GUARDIAN.bounds.riskAttitude).not.toContain("AGGRESSIVE");
    });

    it("BRUISER excludes CAUTIOUS riskAttitude", () => {
      expect(FRAME_CONFIG.BRUISER.bounds.riskAttitude).not.toContain("CAUTIOUS");
    });
  });

  describe("frame-specific tradeTempo exclusions", () => {
    it("BERSERKER excludes OPPORTUNISTIC tradeTempo", () => {
      expect(FRAME_CONFIG.BERSERKER.bounds.tradeTempo).not.toContain("OPPORTUNISTIC");
    });
  });

  describe("frame-specific combatPatience exclusions", () => {
    it("BRAWLER excludes STRATEGIC combatPatience", () => {
      expect(FRAME_CONFIG.BRAWLER.bounds.combatPatience).not.toContain("STRATEGIC");
    });
  });
});
