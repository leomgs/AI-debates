import { describe, expect, it } from "vitest";
import {
  groupEpisodes,
  listRefetchInterval,
  parseStatusFilter,
  serializeStatusFilter,
  studioListHref,
  type EpisodeListItem,
} from "./episode-list";
import type { EpisodeStatus } from "./episode-status";
import { POLLING_INTERVALS_MS } from "./polling";

function episode(id: string, status: EpisodeStatus, createdAt: string): EpisodeListItem {
  return { id, status, title: `Episodio ${id}`, language: "ES", createdAt, publishedAt: null };
}

describe("groupEpisodes (AC 3.16)", () => {
  it("agrupa según la columna Grupo del mapeo de estados", () => {
    const groups = groupEpisodes([
      episode("a", "DEBATING", "2026-09-01T10:00:00.000Z"),
      episode("b", "PENDING_REVIEW", "2026-09-02T10:00:00.000Z"),
      episode("c", "FAILED", "2026-09-03T10:00:00.000Z"),
      episode("d", "REQUIRES_HUMAN_REVIEW", "2026-09-04T10:00:00.000Z"),
      episode("e", "READY_FOR_RENDER", "2026-09-05T10:00:00.000Z"),
      episode("f", "APPROVED", "2026-09-06T10:00:00.000Z"),
    ]);
    expect(groups["requires-action"].map((e) => e.id)).toEqual(["d", "b"]);
    expect(groups["in-progress"].map((e) => e.id)).toEqual(["f", "a"]);
    expect(groups.finished.map((e) => e.id)).toEqual(["e", "c"]);
  });

  it("ordena cada grupo de más nuevo a más viejo sin depender del orden de la API", () => {
    const groups = groupEpisodes([
      episode("viejo", "CREATED", "2026-01-01T00:00:00.000Z"),
      episode("nuevo", "RESEARCHING", "2026-09-27T00:00:00.000Z"),
      episode("medio", "JUDGING", "2026-05-01T00:00:00.000Z"),
    ]);
    expect(groups["in-progress"].map((e) => e.id)).toEqual(["nuevo", "medio", "viejo"]);
  });

  it("devuelve los tres grupos vacíos sin episodios", () => {
    expect(groupEpisodes([])).toEqual({ "requires-action": [], "in-progress": [], finished: [] });
  });

  it("no modifica el array recibido", () => {
    const input = [episode("a", "FAILED", "2026-01-01T00:00:00.000Z"), episode("b", "FAILED", "2026-02-01T00:00:00.000Z")];
    groupEpisodes(input);
    expect(input.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("listRefetchInterval (AC 3.21, D19)", () => {
  it("refresca cada 10 s si hay algún episodio En curso", () => {
    const episodes = [episode("a", "PENDING_REVIEW", "2026-09-01T00:00:00.000Z"), episode("b", "GENERATING_AUDIO", "2026-09-01T00:00:00.000Z")];
    expect(listRefetchInterval(episodes)).toBe(POLLING_INTERVALS_MS.episodeList);
    expect(POLLING_INTERVALS_MS.episodeList).toBe(10_000);
  });

  it("no refresca si nada está En curso, sin datos o con la lista vacía", () => {
    const episodes = [episode("a", "PENDING_REVIEW", "2026-09-01T00:00:00.000Z"), episode("b", "COMPLETED", "2026-09-01T00:00:00.000Z")];
    expect(listRefetchInterval(episodes)).toBe(false);
    expect(listRefetchInterval(undefined)).toBe(false);
    expect(listRefetchInterval([])).toBe(false);
  });
});

describe("parseStatusFilter (AC 3.19)", () => {
  it("lee el CSV de estados", () => {
    expect(parseStatusFilter(["PENDING_REVIEW,FAILED"])).toEqual(["PENDING_REVIEW", "FAILED"]);
  });

  it("ignora valores inválidos sin romper", () => {
    expect(parseStatusFilter(["PENDING_REVIEW,NO_EXISTE,<script>,FAILED"])).toEqual(["PENDING_REVIEW", "FAILED"]);
    expect(parseStatusFilter(["cualquier cosa"])).toEqual([]);
    expect(parseStatusFilter([""])).toEqual([]);
    expect(parseStatusFilter([",,,"])).toEqual([]);
    expect(parseStatusFilter([])).toEqual([]);
  });

  it("tolera minúsculas, espacios, repetidos y el parámetro repetido", () => {
    expect(parseStatusFilter([" failed , Failed,FAILED", "debating"])).toEqual(["DEBATING", "FAILED"]);
  });

  it("devuelve los estados en el orden de la tabla de la spec, no en el de la URL", () => {
    expect(parseStatusFilter(["FAILED,CREATED,PENDING_REVIEW"])).toEqual(["CREATED", "PENDING_REVIEW", "FAILED"]);
  });

  it("no acepta nombres de propiedades del objeto como estados", () => {
    expect(parseStatusFilter(["constructor,__proto__,toString"])).toEqual([]);
  });
});

describe("serializeStatusFilter", () => {
  it("arma el CSV en orden canónico y null sin filtro", () => {
    expect(serializeStatusFilter(["FAILED", "CREATED"])).toBe("CREATED,FAILED");
    expect(serializeStatusFilter([])).toBeNull();
  });

  it("ida y vuelta con parseStatusFilter", () => {
    const csv = serializeStatusFilter(["REQUIRES_HUMAN_REVIEW", "PENDING_REVIEW"]);
    expect(parseStatusFilter([csv ?? ""])).toEqual(["PENDING_REVIEW", "REQUIRES_HUMAN_REVIEW"]);
  });
});

describe("studioListHref", () => {
  it("pone el filtro con comas legibles", () => {
    expect(studioListHref("", ["PENDING_REVIEW", "FAILED"])).toBe("/studio?status=PENDING_REVIEW,FAILED");
  });

  it("quita el parámetro sin filtro", () => {
    expect(studioListHref("status=FAILED", [])).toBe("/studio");
  });

  it("reemplaza un filtro inválido o repetido y conserva otros parámetros", () => {
    expect(studioListHref("status=NADA&status=X&otro=1", ["DEBATING"])).toBe("/studio?status=DEBATING&otro=1");
  });
});
