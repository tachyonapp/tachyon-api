/**
 * DataLoaders — per-request batch loader instances for the GraphQL API.
 *
 * WHY DATALOADERS?
 * GraphQL resolvers execute independently. Without batching, a query like
 * `bots { owner { email } }` for 20 bots would fire 20 separate SELECT queries
 * to resolve each bot's owner — the classic N+1 problem.
 *
 * DataLoader solves this by coalescing all `userById.load(id)` calls made within
 * a single event-loop tick into one batched `WHERE id IN (...)` query, then
 * distributing the results back to each individual caller.
 *
 * WHY PER-REQUEST?
 * DataLoader caches results by key for the lifetime of the instance. If loaders
 * were shared across requests, user A's data could be served to user B from the
 * in-memory cache. It is CRITICAL that createDataLoaders() MUST only be called
 * inside buildContext() to ensure each request gets a fresh, isolated set of loaders
 * and prevents cache poisoning and incorrect data.
 */
import DataLoader from "dataloader";
import type { Kysely } from "kysely";
import type {
  DB,
  UsersRow,
  BotsRow,
  BotSettingsRow,
  ProposalsRow,
  PositionsRow,
} from "@tachyonapp/tachyon-db";

export interface DataLoaders {
  userById: DataLoader<string, UsersRow | null>;
  botById: DataLoader<string, BotsRow | null>;
  botSettingsById: DataLoader<string, BotSettingsRow | null>;
  botFrameById: DataLoader<string, { id: string; name: string } | null>;
  proposalsByBotId: DataLoader<string, ProposalsRow[]>;
  positionByBotId: DataLoader<string, PositionsRow | null>;
}

/**
 * Creates a fresh set of DataLoader instances for a single request.
 *
 * CRITICAL: Call this ONLY inside buildContext() — once per request.
 * Never hoist DataLoader instances to module scope. Sharing loaders across
 * requests causes cache poisoning and incorrect data.
 */
export function createDataLoaders(db: Kysely<DB>): DataLoaders {
  return {
    userById: new DataLoader<string, UsersRow | null>(async (ids) => {
      const users = await db
        .selectFrom("users")
        .selectAll()
        .where("id", "in", ids as string[])
        .execute();
      const map = new Map(users.map((u) => [String(u.id), u]));
      return ids.map((id) => map.get(id) ?? null);
    }),

    botById: new DataLoader<string, BotsRow | null>(async (ids) => {
      const bots = await db
        .selectFrom("bots")
        .selectAll()
        .where("id", "in", ids as string[])
        .where("status", "!=", "ARCHIVED")
        .execute();
      const map = new Map(bots.map((b) => [String(b.id), b]));
      return ids.map((id) => map.get(id) ?? null);
    }),

    // Key: bot_settings.id (i.e. bots.current_settings_id)
    // Used by Bot field resolvers for dailyMaxLoss, dailyMaxGain, riskAttitude, etc.
    // DataLoader deduplicates — multiple settings fields on the same bot fire one query.
    botSettingsById: new DataLoader<string, BotSettingsRow | null>(
      async (ids) => {
        const settings = await db
          .selectFrom("bot_settings")
          .selectAll()
          .where("id", "in", ids as string[])
          .execute();
        const map = new Map(settings.map((s) => [String(s.id), s]));
        return ids.map((id) => map.get(id) ?? null);
      },
    ),

    // Key: bot_frames.id (i.e. bots.frame_id)
    // Only name is needed by the frame field resolver — select minimally.
    botFrameById: new DataLoader<
      string,
      { id: string; name: string } | null
    >(async (ids) => {
      const frames = await db
        .selectFrom("bot_frames")
        .select(["id", "name"])
        .where("id", "in", ids as string[])
        .execute();
      const map = new Map(
        frames.map((f) => [String(f.id), { id: String(f.id), name: f.name }]),
      );
      return ids.map((id) => map.get(id) ?? null);
    }),

    // Table is trade_proposals — not proposals
    proposalsByBotId: new DataLoader<string, ProposalsRow[]>(async (botIds) => {
      const proposals = await db
        .selectFrom("trade_proposals")
        .selectAll()
        .where("bot_id", "in", botIds as string[])
        .execute();
      const grouped = new Map<string, ProposalsRow[]>();
      for (const p of proposals) {
        const key = String(p.bot_id);
        const arr = grouped.get(key) ?? [];
        arr.push(p);
        grouped.set(key, arr);
      }
      return botIds.map((id) => grouped.get(id) ?? []);
    }),

    positionByBotId: new DataLoader<string, PositionsRow | null>(
      async (botIds) => {
        const positions = await db
          .selectFrom("positions")
          .selectAll()
          .where("bot_id", "in", botIds as string[])
          .where("status", "=", "OPEN")
          .execute();
        const map = new Map(positions.map((p) => [String(p.bot_id), p]));
        return botIds.map((id) => map.get(id) ?? null);
      },
    ),
  };
}
