import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Aquí es donde Prisma v7 lee de forma segura tu variable de entorno
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  },
});