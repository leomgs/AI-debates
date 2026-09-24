#!/usr/bin/env node
// spec 002 (docs/product/002-workspace-restructure.md) — criterio de
// aceptación: "un chequeo automatizado falla si aparece un import de
// apps/api dentro de packages/video (o de cualquier apps/* dentro de
// packages/*)" + "ningún archivo bajo packages/ importa con paths
// relativos que salgan de su propio paquete". Node plano, no TS: es una
// utilidad de repo, no pertenece a ningún paquete del workspace.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else if (/\.tsx?$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

// import ... from "..." | require("...") — capturamos el specifier crudo,
// sin distinguir sintaxis (alcanza para este chequeo).
const IMPORT_RE = /(?:from\s+|require\()\s*["']([^"']+)["']/g;

function findViolations() {
  const violations = [];
  let packageDirs;
  try {
    packageDirs = readdirSync(PACKAGES_DIR);
  } catch {
    return violations; // packages/ no existe todavía
  }

  for (const pkgName of packageDirs) {
    const pkgDir = join(PACKAGES_DIR, pkgName);
    if (!statSync(pkgDir).isDirectory()) continue;

    for (const file of walk(pkgDir)) {
      const content = readFileSync(file, "utf-8");
      const relFile = relative(ROOT, file);

      for (const match of content.matchAll(IMPORT_RE)) {
        const specifier = match[1];

        // Import de apps/* (por nombre de paquete @ai-trend-debates/api o
        // @ai-trend-debates/dashboard, o por path relativo que resuelva ahí).
        if (specifier.includes("@ai-trend-debates/api") || specifier.includes("@ai-trend-debates/dashboard")) {
          violations.push(`${relFile}: importa "${specifier}" (apps/* dentro de packages/*)`);
          continue;
        }
        if (specifier.startsWith(".")) {
          const resolved = resolve(join(file, ".."), specifier);
          const relResolved = relative(pkgDir, resolved);
          // Path relativo que sale del propio paquete (../../algo por fuera
          // de pkgDir) — ".." al principio del path relativo resuelto.
          if (relResolved.startsWith("..")) {
            violations.push(`${relFile}: import relativo "${specifier}" sale de su propio paquete`);
          }
        }
      }
    }
  }
  return violations;
}

const violations = findViolations();
if (violations.length > 0) {
  console.error("check:boundaries falló — imports que violan los límites de packages/:\n");
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log("check:boundaries OK — packages/ no importa nada de apps/* ni cruza límites de paquete.");
