"use client";

import { ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  EPISODE_STATUSES,
  EPISODE_STATUS_UI,
  STUDIO_GROUP_LABELS,
  STUDIO_GROUP_ORDER,
  type EpisodeStatus,
} from "@/lib/episode-status";

// Filtro por estado de /studio (AC 3.19): selección múltiple sobre los 14
// valores, agrupados como en la lista para encontrarlos rápido. El estado
// vive en la URL; este componente solo avisa el nuevo valor.
export function StatusFilter({
  selected,
  onChange,
}: {
  selected: readonly EpisodeStatus[];
  onChange: (statuses: EpisodeStatus[]) => void;
}) {
  function toggle(status: EpisodeStatus, checked: boolean) {
    onChange(checked ? [...selected, status] : selected.filter((current) => current !== status));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <ListFilter aria-hidden="true" />
          Estado
          {selected.length > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
              {selected.length}
              <span className="sr-only"> seleccionados</span>
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold">Filtrar por estado</legend>
          {STUDIO_GROUP_ORDER.map((group) => (
            <div key={group} className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{STUDIO_GROUP_LABELS[group]}</p>
              <ul className="space-y-1">
                {EPISODE_STATUSES.filter((status) => EPISODE_STATUS_UI[status].group === group).map((status) => (
                  <li key={status}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={selected.includes(status)}
                        onChange={(event) => toggle(status, event.target.checked)}
                      />
                      {EPISODE_STATUS_UI[status].label}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </fieldset>
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 w-full"
          onClick={() => onChange([])}
          disabled={selected.length === 0}
        >
          Quitar filtro
        </Button>
      </PopoverContent>
    </Popover>
  );
}
