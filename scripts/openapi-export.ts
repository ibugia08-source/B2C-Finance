/**
 * Grava docs/api/openapi.json a partir de src/lib/api/openapi.ts (a fonte).
 * `npm run openapi:export`. O teste tests/api-openapi.test.ts falha se o
 * arquivo versionado ficar diferente do gerado.
 */
import { writeFileSync } from "fs";
import { join } from "path";
import { buildOpenApiSpec } from "@/lib/api/openapi";

const destino = join(process.cwd(), "docs/api/openapi.json");
writeFileSync(destino, JSON.stringify(buildOpenApiSpec(), null, 2) + "\n");
console.log(`OpenAPI gravada em ${destino}`);
