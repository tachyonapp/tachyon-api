import { builder } from "../../builder";

// user_id is denormalized on positions — no JOIN needed for ownership filtering
builder.queryField("positions", (t) =>
  t.field({
    type: ["Position"],
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      return ctx.db
        .selectFrom("positions")
        .selectAll()
        .where("user_id", "=", ctx.auth!.userId)
        .execute();
    },
  }),
);
