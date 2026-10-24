#!/usr/bin/env node
/** `typesql-prisma`: a Prisma generator; Prisma runs it during `prisma generate`. */
import { generator } from "./generator/index.js";
import { serveGenerator } from "./generator/protocol.js";

if (process.env["PRISMA_GENERATOR_INVOCATION"] === undefined && process.stdin.isTTY) {
  console.log(`typesql-prisma is a Prisma generator. Add it to schema.prisma and run \`prisma generate\`:

  generator typesql {
    provider = "typesql-prisma"
    output   = "../src/db/typesql.ts"
  }`);
} else {
  await serveGenerator(generator);
}
