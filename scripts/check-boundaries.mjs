#!/usr/bin/env node
// Límites de imports del workspace. Node plano, no TS: es una utilidad de
// repo, no pertenece a ningún paquete del workspace.
//
// - spec 002 (docs/product/002-workspace-restructure.md), criterio de
//   aceptación: "un chequeo automatizado falla si aparece un import de
//   apps/api dentro de packages/video (o de cualquier apps/* dentro de
//   packages/*)" + "ningún archivo bajo packages/ importa con paths
//   relativos que salgan de su propio paquete".
// - spec 003 (docs/product/003-dashboard-ui.md), "Límites del workspace":
//   apps/dashboard no importa nada de apps/api (solo consume openapi.json
//   como artefacto, vía generate:api, más los paquetes de packages/). Se
//   prohíbe @ai-trend-debates/api y cualquier import relativo que salga de
//   apps/dashboard.
//
// Corre como dependencia de toda tarea `build` de Turborepo
// (`//#check:boundaries` en turbo.json), así que `pnpm build` falla si hay
// una violación. También se puede correr suelto con `pnpm check:boundaries`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const SKIPPED_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "out", "build", "coverage"]);
const SOURCE_FILE_RE = /\.(?:[cm]?[jt]sx?)$/;

// Cada regla: qué directorios son "paquetes" a revisar y qué specifiers
// por nombre están prohibidos adentro. Los imports relativos que salen del
// propio paquete están prohibidos en todas.
const RULES = [
  {
    label: "packages/*",
    packageDirs: () => listSubdirs(join(ROOT, "packages")),
    forbidden: ["@ai-trend-debates/api", "@ai-trend-debates/dashboard"],
    reason: "apps/* dentro de packages/*",
  },
  {
    label: "apps/dashboard",
    packageDirs: () => existingDirs([join(ROOT, "apps", "dashboard")]),
    forbidden: ["@ai-trend-debates/api"],
    reason: "apps/api dentro de apps/dashboard; el dashboard solo consume openapi.json",
  },
];

function listSubdirs(dir) {
  try {
    return readdirSync(dir)
      .map((entry) => join(dir, entry))
      .filter((full) => statSync(full).isDirectory());
  } catch {
    return []; // el directorio no existe todavía
  }
}

function existingDirs(dirs) {
  return dirs.filter((dir) => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else if (SOURCE_FILE_RE.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

// Capturamos el specifier crudo de todas las formas de import que resuelven
// un módulo, sin distinguir sintaxis:
//   import x from "y" / import type { X } from "y" / export { x } from "y"
//   import "y"                (import solo por efectos)
//   import("y")               (import dinámico)
//   require("y")
// No es un parser: un comentario con la misma forma también cuenta. Es
// preferible un falso positivo (se ve y se corrige) a dejar pasar un import.
const IMPORT_RES = [
  /\bfrom\s*["'`]([^"'`]+)["'`]/g,
  /\bimport\s*["'`]([^"'`]+)["'`]/g,
  /\bimport\s*\(\s*["'`]([^"'`]+)["'`]/g,
  /\brequire\s*\(\s*["'`]([^"'`]+)["'`]/g,
];

function extractSpecifiers(content) {
  const specifiers = [];
  for (const re of IMPORT_RES) {
    for (const match of content.matchAll(re)) specifiers.push(match[1]);
  }
  return specifiers;
}

function matchesForbidden(specifier, forbidden) {
  return forbidden.find((name) => specifier === name || specifier.startsWith(`${name}/`));
}

function findViolations() {
  const violations = [];
  for (const rule of RULES) {
    for (const pkgDir of rule.packageDirs()) {
      for (const file of walk(pkgDir)) {
        const content = readFileSync(file, "utf-8");
        const relFile = relative(ROOT, file);

        for (const specifier of extractSpecifiers(content)) {
          const forbiddenName = matchesForbidden(specifier, rule.forbidden);
          if (forbiddenName) {
            violations.push(`${relFile}: importa "${specifier}" (${rule.reason})`);
            continue;
          }
          if (specifier.startsWith(".")) {
            const resolved = resolve(join(file, ".."), specifier);
            const relResolved = relative(pkgDir, resolved);
            // ".." al principio del path relativo resuelto = sale del paquete.
            if (relResolved.startsWith("..")) {
              violations.push(`${relFile}: import relativo "${specifier}" sale de su propio paquete (${rule.label})`);
            }
          }
        }
      }
    }
  }
  return violations;
}

const violations = findViolations();
if (violations.length > 0) {
  console.error("check:boundaries falló — imports que violan los límites del workspace:\n");
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log(
  "check:boundaries OK — packages/ no importa nada de apps/*, apps/dashboard no importa apps/api y nadie cruza límites de paquete con paths relativos."
);
