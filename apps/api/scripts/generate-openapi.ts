import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument } from '../src/shared/http/openapi-document';
import { SESSION_COOKIE_NAME } from '../src/modules/auth/session-cookie';

// spec 001 (docs/product/001-openapi-contract-zod.md) — genera openapi.json
// en la raíz del MONOREPO (no de apps/api/) a partir del mismo documento
// que sirve /docs en main.ts (buildOpenApiDocument), para que no puedan
// desincronizarse. Sin listen(): solo necesitamos la metadata de
// rutas/schemas, no un servidor HTTP real. Correr con: pnpm openapi:generate
// (raíz del monorepo) — spec 002 movió este script a apps/api/scripts/, dos
// niveles down de donde vive openapi.json ahora.
async function main() {
  // abortOnError: false para que un entorno inválido (por ejemplo, sin
  // NODE_ENV o sin la credencial del curador) llegue al catch de abajo y se
  // imprima. Con el default (true) y logger: false, Nest termina el proceso
  // con exit 1 sin mostrar ningún mensaje.
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  const document = buildOpenApiDocument(app, SESSION_COOKIE_NAME);

  const outputPath = resolve(__dirname, '..', '..', '..', 'openapi.json');
  writeFileSync(outputPath, JSON.stringify(document, null, 2) + '\n', 'utf-8');
  console.log(`openapi.json escrito en ${outputPath}`);

  await app.close();
}

main().catch((err) => {
  console.error('generate-openapi falló', err);
  process.exit(1);
});
