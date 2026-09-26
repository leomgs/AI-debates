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
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");

const SKIPPED_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "out", "build", "coverage"]);
const SOURCE_FILE_RE = /\.(?:[cm]?[jt]sx?)$/;

// Cada regla: qué directorios son "paquetes" a revisar y qué specifiers
// por nombre están prohibidos adentro. En todas está prohibido apuntar fuera
// del propio paquete por path: relativo, absoluto, `file:`, alias de
// tsconfig (`@/..`) o `/// <reference path>`.
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

// Capturamos el specifier crudo de todas las formas que resuelven un módulo
// o un archivo, sin distinguir sintaxis:
//   import x from "y" / import type { X } from "y" / export { x } from "y"
//   import "y"                (import solo por efectos)
//   import("y")               (import dinámico, con comentarios en el medio:
//                              `import(/* webpackChunkName: "x" */ "y")`)
//   require("y")
//   /// <reference path="y" />  y  /// <reference types="y" />
// No es un parser: un comentario con la misma forma también cuenta. Es
// preferible un falso positivo (se ve y se corrige) a dejar pasar un import.
const GAP = String.raw`(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)*`; // espacios y comentarios
const QUOTED = String.raw`["'\`]([^"'\`]+)["'\`]`;
const MODULE_RES = [
  new RegExp(String.raw`\bfrom${GAP}${QUOTED}`, "g"),
  new RegExp(String.raw`\bimport${GAP}${QUOTED}`, "g"),
  new RegExp(String.raw`\bimport${GAP}\(${GAP}${QUOTED}`, "g"),
  new RegExp(String.raw`\brequire${GAP}\(${GAP}${QUOTED}`, "g"),
  /\/\/\/\s*<reference\s+types\s*=\s*["']([^"']+)["']/g,
];
// `path` de una directiva triple-slash es siempre relativo al archivo, aunque
// no empiece con "." ("../../api/x.d.ts" o "x.d.ts").
const REFERENCE_PATH_RE = /\/\/\/\s*<reference\s+path\s*=\s*["']([^"']+)["']/g;

function extractSpecifiers(content) {
  const specifiers = [];
  for (const re of MODULE_RES) {
    for (const match of content.matchAll(re)) specifiers.push({ specifier: match[1], kind: "module" });
  }
  for (const match of content.matchAll(REFERENCE_PATH_RE)) specifiers.push({ specifier: match[1], kind: "path" });
  return specifiers;
}

function matchesForbidden(specifier, forbidden) {
  return forbidden.find((name) => specifier === name || specifier.startsWith(`${name}/`));
}

// Alias de `compilerOptions.paths` del tsconfig del paquete (por ejemplo
// "@/*" → "./src/*" en el dashboard). Se expanden antes del chequeo de
// relativos: "@/../../api/src/x" es un import relativo disfrazado.
//
// El tsconfig se lee con la API de TypeScript, no con JSON.parse ni con
// regex: admite comentarios y comas finales (un regex de comentarios se come
// el "/*" de "@/*") y resuelve `extends`, así que también cuentan los alias
// heredados. `typescript` se resuelve desde el propio paquete (todos lo
// tienen como devDependency): el script no suma dependencias en la raíz.
function readPathAliases(pkgDir) {
  const configPath = join(pkgDir, "tsconfig.json");
  if (!existsSync(configPath)) return [];

  let ts;
  try {
    ts = createRequire(join(pkgDir, "package.json"))("typescript");
  } catch {
    throw new Error(
      `${relative(ROOT, pkgDir)} tiene tsconfig.json pero no resuelve "typescript": sin él no se pueden leer sus alias.`,
    );
  }
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  if (error) {
    throw new Error(`${relative(ROOT, configPath)}: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`);
  }
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, pkgDir, undefined, configPath);
  // Sin baseUrl, TypeScript resuelve `paths` contra el tsconfig que los
  // declara (pathsBasePath), que con `extends` puede ser otro archivo.
  const baseDir = options.baseUrl ?? options.pathsBasePath ?? pkgDir;
  return Object.entries(options.paths ?? {}).flatMap(([pattern, targets]) => {
    const [target] = targets;
    if (!target) return [];
    return pattern.endsWith("*") && target.endsWith("*")
      ? [{ prefix: pattern.slice(0, -1), dir: resolve(baseDir, target.slice(0, -1)), wildcard: true }]
      : [{ prefix: pattern, dir: resolve(baseDir, target), wildcard: false }];
  });
}

// Devuelve el path en disco al que apunta el specifier, o null si es un
// paquete por nombre (lo cubre `forbidden`).
function resolveToPath(specifier, kind, file, aliases) {
  const fromDir = join(file, "..");
  if (kind === "path") return resolve(fromDir, specifier);
  if (specifier.startsWith("file:")) {
    try {
      return fileURLToPath(specifier);
    } catch {
      return specifier;
    }
  }
  if (specifier.startsWith(".") || isAbsolute(specifier)) return resolve(fromDir, specifier);
  for (const alias of aliases) {
    if (alias.wildcard && specifier.startsWith(alias.prefix)) {
      return resolve(alias.dir, specifier.slice(alias.prefix.length));
    }
    if (!alias.wildcard && specifier === alias.prefix) return alias.dir;
  }
  return null;
}

function findViolations() {
  const violations = [];
  for (const rule of RULES) {
    for (const pkgDir of rule.packageDirs()) {
      const aliases = readPathAliases(pkgDir);
      for (const file of walk(pkgDir)) {
        const content = readFileSync(file, "utf-8");
        const relFile = relative(ROOT, file);

        for (const { specifier, kind } of extractSpecifiers(content)) {
          if (kind === "module" && matchesForbidden(specifier, rule.forbidden)) {
            violations.push(`${relFile}: importa "${specifier}" (${rule.reason})`);
            continue;
          }
          const resolved = resolveToPath(specifier, kind, file, aliases);
          if (resolved === null) continue;
          const relResolved = relative(pkgDir, resolved);
          // ".." al principio del path resuelto, o un path absoluto (otra
          // unidad en Windows), = sale del paquete.
          if (relResolved.startsWith("..") || isAbsolute(relResolved)) {
            violations.push(`${relFile}: "${specifier}" apunta fuera de su propio paquete (${rule.label})`);
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
  "check:boundaries OK — packages/ no importa nada de apps/*, apps/dashboard no importa apps/api y nadie apunta fuera de su paquete por path."
);
