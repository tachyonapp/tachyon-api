import { builder } from "../../builder";

builder.objectType("User", {
  description: "An authenticated Tachyon user",
  fields: (t) => ({
    id: t.exposeID("id"),
    email: t.exposeString("email"),
    auth0Id: t.field({
      type: "String",
      resolve: (user) => user.auth0_subject, // snake_case DB col → camelCase field
    }),
    createdAt: t.field({
      type: "DateTime",
      resolve: (user) => new Date(user.created_at),
    }),
  }),
});
