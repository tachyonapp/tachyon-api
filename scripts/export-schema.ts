import { buildSchema } from "../src/graphql/schema";
import { printSchema, lexicographicSortSchema } from "graphql";
import { writeFileSync } from "fs";
import { resolve } from "path";

const schema = buildSchema();
const sorted = lexicographicSortSchema(schema); // deterministic output for clean git diffs
const sdl = printSchema(sorted);

/**
 * Why lexicographic sort?
 *
 * Ensures the SDL output is deterministic regardless of import order.
 * Prevents noisy git diffs when schema types are added.
 */
const outputPath = resolve(__dirname, "../schema.graphql");
writeFileSync(outputPath, sdl, "utf-8");
console.log(`Schema exported to ${outputPath}`);
