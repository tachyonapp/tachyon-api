import type {
  RiskAttitude,
  TradeTempo,
  CombatPatience,
  BotFrameName,
} from "../graphql/types/enums";

export type { RiskAttitude, TradeTempo, CombatPatience, BotFrameName };

export interface MarketAwarenessDefaults {
  momentum: number;
  meanReversion: number;
  volatility: number;
  trendFollowing: number;
}

export interface FrameConfig {
  strategyName: string;
  description: string;
  colorway: string;
  defaults: {
    riskAttitude: RiskAttitude;
    tradeTempo: TradeTempo;
    combatPatience: CombatPatience;
    exitPersonality: string;
    stopLossStyle: string;
    marketAwareness: MarketAwarenessDefaults;
    allocationPct: number;
    dailyMaxLossPct: number; // decimal fraction, e.g. 0.10 = 10% of allocated capital/day
  };
  bounds: {
    riskAttitude: RiskAttitude[];
    tradeTempo: TradeTempo[];
    combatPatience: CombatPatience[];
    allocationPct: { min: number; max: number };
    dailyMaxLoss: {
      minPct: number;
      maxPct: number;
      // Dollar enforcement is NOT stored — the Rule Engine computes it:
      //   dailyMaxLossUsd = dailyMaxLossPct × (allocationPct × accountBalance)
    };
    marketAwareness: {
      momentum: { min: number; max: number };
      meanReversion: { min: number; max: number };
      volatility: { min: number; max: number };
      trendFollowing: { min: number; max: number };
    };
  };
}

export const FRAME_CONFIG: Record<BotFrameName, FrameConfig> = {
  SCOUT: {
    strategyName: "Momentum Confirmation",
    colorway: "#2C6BED",
    description: "Quick reactions, low risk. Fires on momentum signals. Enters on confirmed momentum — price above key moving averages with increasing volume. Exits when momentum flattens or reversal signals emerge.",
    defaults: {
      riskAttitude: "BALANCED",
      tradeTempo: "ACTIVE",
      combatPatience: "CALCULATED",
      exitPersonality: "BALANCED",
      stopLossStyle: "FLEXIBLE",
      marketAwareness: {
        momentum: 0.75,
        meanReversion: 0.15,
        volatility: 0.45,
        trendFollowing: 0.75,
      },
      allocationPct: 0.2,
      dailyMaxLossPct: 0.1,
    },
    bounds: {
      riskAttitude: ["CAUTIOUS", "BALANCED", "AGGRESSIVE"],
      tradeTempo: ["OPPORTUNISTIC", "ACTIVE", "RELENTLESS"],
      combatPatience: ["IMPULSIVE", "CALCULATED", "PATIENT"],
      allocationPct: { min: 0.05, max: 0.5 },
      dailyMaxLoss: { minPct: 0.04, maxPct: 0.15 }, // floor 4% — "low risk" FTUE positioning
      marketAwareness: {
        momentum: { min: 0.5, max: 1.0 },
        meanReversion: { min: 0.0, max: 0.3 },
        volatility: { min: 0.2, max: 0.7 },
        trendFollowing: { min: 0.5, max: 1.0 },
      },
    },
  },
  SNIPER: {
    strategyName: "Breakout Trading",
    colorway: "#E8F4FF",
    description: "Selective, precision trades. Waits for the perfect setup. Enters on a clean breakout above a defined resistance level with volume confirmation. Holds until price target is reached or a hard stop triggers. Low trade frequency, high selectivity.",
    defaults: {
      riskAttitude: "BALANCED",
      tradeTempo: "OPPORTUNISTIC",
      combatPatience: "PATIENT",
      exitPersonality: "PATIENT",
      stopLossStyle: "HARD",
      marketAwareness: {
        momentum: 0.55,
        meanReversion: 0.1,
        volatility: 0.35,
        trendFollowing: 0.65,
      },
      allocationPct: 0.2,
      dailyMaxLossPct: 0.1,
    },
    bounds: {
      riskAttitude: ["CAUTIOUS", "BALANCED", "AGGRESSIVE"],
      tradeTempo: ["OPPORTUNISTIC", "ACTIVE"],
      combatPatience: ["CALCULATED", "PATIENT", "STRATEGIC"],
      allocationPct: { min: 0.05, max: 0.6 },
      dailyMaxLoss: { minPct: 0.03, maxPct: 0.15 }, // floor 3% — precision/infrequent entry; tight tolerance expected
      marketAwareness: {
        momentum: { min: 0.3, max: 0.8 },
        meanReversion: { min: 0.0, max: 0.2 },
        volatility: { min: 0.1, max: 0.6 },
        trendFollowing: { min: 0.4, max: 0.9 },
      },
    },
  },
  GUARDIAN: {
    strategyName: "Mean Reversion",
    colorway: "#1C9C61",
    description:
      "Defensive, capital-preserving. Low risk, mean reversion focus. Buys oversold conditions when price reverts toward its statistical mean after an extended deviation. Exits near mean or when reversion stalls. Avoids trending markets; sized conservatively.",
    defaults: {
      riskAttitude: "CAUTIOUS",
      tradeTempo: "OPPORTUNISTIC",
      combatPatience: "PATIENT",
      exitPersonality: "BALANCED",
      stopLossStyle: "FLEXIBLE",
      marketAwareness: {
        momentum: 0.15,
        meanReversion: 0.8,
        volatility: 0.2,
        trendFollowing: 0.2,
      },
      allocationPct: 0.15,
      dailyMaxLossPct: 0.05,
    },
    bounds: {
      riskAttitude: ["CAUTIOUS", "BALANCED"], // AGGRESSIVE excluded — contradicts capital-preservation identity
      tradeTempo: ["OPPORTUNISTIC", "ACTIVE"],
      combatPatience: ["CALCULATED", "PATIENT", "STRATEGIC"],
      allocationPct: { min: 0.03, max: 0.4 },
      dailyMaxLoss: { minPct: 0.02, maxPct: 0.08 }, // tightest range — capital preservation identity; 10% ceiling would contradict "defensive" contract
      marketAwareness: {
        momentum: { min: 0.0, max: 0.3 },
        meanReversion: { min: 0.6, max: 1.0 }, // forced high — defining characteristic
        volatility: { min: 0.0, max: 0.4 },
        trendFollowing: { min: 0.0, max: 0.4 },
      },
    },
  },
  BRUISER: {
    strategyName: "Trend Following",
    colorway: "#F2B705",
    description: "Slower, higher conviction. Rides trends for maximum capture. Enters established uptrends on pullbacks to support, targeting continuation of the primary trend. Holds through minor noise; exits on trend structure break.",
    defaults: {
      riskAttitude: "BALANCED",
      tradeTempo: "ACTIVE",
      combatPatience: "STRATEGIC",
      exitPersonality: "PATIENT",
      stopLossStyle: "FLEXIBLE",
      marketAwareness: {
        momentum: 0.45,
        meanReversion: 0.1,
        volatility: 0.25,
        trendFollowing: 0.8,
      },
      allocationPct: 0.25,
      dailyMaxLossPct: 0.12,
    },
    bounds: {
      riskAttitude: ["BALANCED", "AGGRESSIVE"], // CAUTIOUS excluded — contradicts high-conviction identity
      tradeTempo: ["OPPORTUNISTIC", "ACTIVE"],
      combatPatience: ["CALCULATED", "PATIENT", "STRATEGIC"],
      allocationPct: { min: 0.1, max: 0.7 },
      dailyMaxLoss: { minPct: 0.06, maxPct: 0.2 }, // floor 6% — trend following needs room for intraday counter-moves
      marketAwareness: {
        momentum: { min: 0.2, max: 0.7 },
        meanReversion: { min: 0.0, max: 0.2 },
        volatility: { min: 0.0, max: 0.5 },
        trendFollowing: { min: 0.6, max: 1.0 }, // forced high — defining characteristic
      },
    },
  },
  BERSERKER: {
    strategyName: "Volatility Trading",
    colorway: "#D64545",
    description: "Aggressive, high volatility. High risk, fast in and out. Targets high-volatility conditions — wide ATR, elevated IV, or momentum surges. Enters on breakouts or volume spikes; exits fast when volatility compresses. Adaptive stops accommodate wide intraday swings.",
    defaults: {
      riskAttitude: "AGGRESSIVE",
      tradeTempo: "RELENTLESS",
      combatPatience: "IMPULSIVE",
      exitPersonality: "QUICK_FINISHER",
      stopLossStyle: "ADAPTIVE",
      marketAwareness: {
        momentum: 0.7,
        meanReversion: 0.1,
        volatility: 0.85,
        trendFollowing: 0.5,
      },
      allocationPct: 0.15,
      dailyMaxLossPct: 0.15,
    },
    bounds: {
      riskAttitude: ["BALANCED", "AGGRESSIVE"],
      tradeTempo: ["ACTIVE", "RELENTLESS"], // OPPORTUNISTIC excluded — volatility windows require frequent scanning
      combatPatience: ["IMPULSIVE", "CALCULATED"],
      // Note: allocationPct ceiling is lower than BRUISER despite being most aggressive frame.
      // Volatility strategy + high allocation = fastest path to account wipeout. UI must surface explanation.
      allocationPct: { min: 0.05, max: 0.4 },
      dailyMaxLoss: { minPct: 0.1, maxPct: 0.25 }, // floor 10% — volatility strategy with < 10% floor stands down on normal intraday moves before meaningful trade windows
      marketAwareness: {
        momentum: { min: 0.4, max: 1.0 },
        meanReversion: { min: 0.0, max: 0.2 },
        volatility: { min: 0.6, max: 1.0 }, // forced high — defining characteristic
        trendFollowing: { min: 0.2, max: 0.8 },
      },
    },
  },
  BRAWLER: {
    strategyName: "Swing Trading",
    colorway: "#8B7CFF",
    description: "Enters early, balanced risk. Medium-duration swing trades. Targets early-stage swing setups — bullish structure at support with neutral-to-improving momentum. Holds for multi-day price expansion toward resistance.",
    defaults: {
      riskAttitude: "BALANCED",
      tradeTempo: "ACTIVE",
      combatPatience: "CALCULATED",
      exitPersonality: "BALANCED",
      stopLossStyle: "FLEXIBLE",
      marketAwareness: {
        momentum: 0.5,
        meanReversion: 0.3,
        volatility: 0.45,
        trendFollowing: 0.5,
      },
      allocationPct: 0.2,
      dailyMaxLossPct: 0.1,
    },
    bounds: {
      riskAttitude: ["CAUTIOUS", "BALANCED", "AGGRESSIVE"],
      tradeTempo: ["OPPORTUNISTIC", "ACTIVE", "RELENTLESS"],
      combatPatience: ["IMPULSIVE", "CALCULATED", "PATIENT"], // STRATEGIC excluded — swing is medium-duration
      allocationPct: { min: 0.05, max: 0.55 },
      dailyMaxLoss: { minPct: 0.05, maxPct: 0.15 }, // floor 5% — the one frame where the universal floor is a natural fit
      marketAwareness: {
        momentum: { min: 0.2, max: 0.8 },
        meanReversion: { min: 0.1, max: 0.5 },
        volatility: { min: 0.2, max: 0.7 },
        trendFollowing: { min: 0.2, max: 0.8 },
      },
    },
  },
};
