import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { DmmfDatamodel } from "./dmmf.js";
import { generateSource, viewNames } from "./emit.js";
import type { GeneratorHandler, GeneratorOptions } from "./protocol.js";

const configString = (v: string | readonly string[] | undefined): string | undefined => (typeof v === "string" ? v : undefined);

/** File the generator writes: `output` itself when it names a `.ts` file, else `<output>/index.ts`. */
export function outputFile(output: string): string {
  return /^\.[mc]?ts$/.test(extname(output)) ? output : join(output, "index.ts");
}

/** Source for a `generate` request (config keys: `importFrom`, `typeName`). */
export function sourceFor(options: GeneratorOptions): string {
  const provider = options.datasources[0]?.activeProvider ?? options.datasources[0]?.provider;
  if (provider !== undefined && provider !== "postgresql" && provider !== "postgres") {
    throw new Error(`typesql-prisma: only the postgresql provider is supported (got "${provider}")`);
  }
  const { importFrom, typeName } = options.generator.config;
  return generateSource(options.dmmf.datamodel as DmmfDatamodel, {
    ...(configString(importFrom) !== undefined && { importFrom: configString(importFrom)! }),
    ...(configString(typeName) !== undefined && { typeName: configString(typeName)! }),
    views: viewNames(options.datamodel),
  });
}

/** The `typesql-prisma` generator: writes the schema file to the configured `output`. */
export const generator: GeneratorHandler = {
  onManifest: () => ({ prettyName: "TypeSQL schema", requiresEngines: [] }),
  async onGenerate(options) {
    const output = options.generator.output?.value;
    if (!output) throw new Error('typesql-prisma: set `output` in the generator block, e.g. output = "../src/db/typesql.ts"');
    const file = outputFile(output);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, sourceFor(options));
  },
};
