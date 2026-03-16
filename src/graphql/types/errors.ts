import { builder } from "../builder";

// BaseError interface
const BaseError = builder.interfaceRef<{ message: string }>("BaseError");
builder.interfaceType(BaseError, {
  fields: (t) => ({
    message: t.exposeString("message"),
  }),
});

// ValidationError: includes field and code
export const ValidationError = builder.objectRef<{
  message: string;
  field: string;
  code: string;
}>("ValidationError");
builder.objectType(ValidationError, {
  interfaces: [BaseError],
  fields: (t) => ({
    message: t.exposeString("message"),
    field: t.exposeString("field"),
    code: t.exposeString("code"),
  }),
});

// AuthError
export const AuthError = builder.objectRef<{ message: string }>("AuthError");
builder.objectType(AuthError, {
  interfaces: [BaseError],
  fields: (t) => ({
    message: t.exposeString("message"),
  }),
});

// NotFoundError
export const NotFoundError = builder.objectRef<{ message: string }>(
  "NotFoundError",
);
builder.objectType(NotFoundError, {
  interfaces: [BaseError],
  fields: (t) => ({
    message: t.exposeString("message"),
  }),
});
