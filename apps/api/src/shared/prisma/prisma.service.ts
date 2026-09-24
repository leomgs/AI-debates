import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import type { Env } from "../config/env.schema";

// Único lugar del proyecto que instancia PrismaClient. Todo acceso a datos
// pasa por este servicio inyectado (coding-rules.md §2).
//
// Prisma 7 requiere un driver adapter explícito incluso para SQLite (ya no
// hay motor nativo implícito) — ver PrismaBetterSqlite3.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaBetterSqlite3({
        url: config.get("DATABASE_URL", { infer: true }),
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
