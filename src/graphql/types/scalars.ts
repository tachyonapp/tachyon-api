import { builder } from "../builder";

builder.scalarType("DateTime", {
  serialize: (value) => {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") return value;
    throw new Error("DateTime must be a Date instance or ISO string");
  },
  parseValue: (value) => {
    if (typeof value !== "string") throw new Error("DateTime must be a string");
    const date = new Date(value);
    if (isNaN(date.getTime())) throw new Error("Invalid DateTime");
    return date;
  },
});

builder.scalarType("Decimal", {
  serialize: (value: string | number) => {
    if (typeof value === "string") return value;
    if (typeof value === "number") return value.toString();
    throw new Error("Decimal must be a string or number");
  },
  parseValue: (value) => {
    if (typeof value !== "string" && typeof value !== "number")
      throw new Error("Decimal must be a string or number");
    return String(value);
  },
});
