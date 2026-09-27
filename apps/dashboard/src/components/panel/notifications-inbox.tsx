"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { errorMessage, unwrap } from "@/lib/api/errors";
import {
  NOTIFICATION_RELATED_STATUS,
  isUnread,
  sortNotifications,
  unreadBadgeText,
  type Notification,
} from "@/lib/notifications";
import { POLLING_INTERVALS_MS } from "@/lib/polling";
import { queryKeys } from "@/lib/query-keys";
import { episodeHref } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { ErrorNotice } from "./error-notice";
import { RelativeTime } from "./relative-time";
import { StatusBadge } from "./status-badge";

async function fetchNotifications(unreadOnly: boolean): Promise<Notification[]> {
  return unwrap(await api.GET("/notifications", { params: { query: { unreadOnly: unreadOnly ? "true" : "false" } } }));
}

// Inbox de notificaciones del header (spec 003, sección 2; D6). Es
// independiente del SSE: funciona aunque no haya ningún episodio abierto.
export function NotificationsInbox() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // Contador (AC 3.10): polling de 30 s (D19) y refetch al volver el foco a
  // la pestaña (refetchOnWindowFocus, explícito aunque es el default).
  const unread = useQuery({
    queryKey: queryKeys.notifications.unread,
    queryFn: () => fetchNotifications(true),
    refetchInterval: POLLING_INTERVALS_MS.inbox,
    refetchOnWindowFocus: true,
  });

  // Historial completo, solo con el inbox abierto (AC 3.11).
  const history = useQuery({
    queryKey: queryKeys.notifications.history,
    queryFn: () => fetchNotifications(false),
    enabled: open,
    refetchInterval: open ? POLLING_INTERVALS_MS.inbox : false,
  });

  const invalidateNotifications = () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });

  const markRead = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.POST("/notifications/{id}/read", { params: { path: { id } } })),
    // El contador baja en el momento; el refetch de onSettled corrige si falló.
    onMutate: (id) => {
      queryClient.setQueryData<Notification[]>(queryKeys.notifications.unread, (current) =>
        current?.filter((notification) => notification.id !== id),
      );
    },
    onSettled: invalidateNotifications,
  });

  const markAllRead = useMutation({
    mutationFn: async () => unwrap(await api.POST("/notifications/read-all")),
    // AC 3.13: el contador queda en 0 sin recargar.
    onSuccess: () => queryClient.setQueryData<Notification[]>(queryKeys.notifications.unread, []),
    onSettled: invalidateNotifications,
  });

  // AC 3.14: si la consulta falla, el contador no muestra un número (ni uno
  // viejo): se reemplaza por un indicador de error.
  const unreadCount = unread.isError ? null : (unread.data?.length ?? null);
  const triggerLabel = unread.isError
    ? "Notificaciones (no se pudo consultar cuántas hay sin leer)"
    : unreadCount
      ? `Notificaciones: ${unreadCount} sin leer`
      : "Notificaciones";

  // AC 3.12: marca como leída y navega al episodio. La navegación no espera
  // a la respuesta: el objetivo del click es llegar al episodio.
  function handleOpenNotification(notification: Notification) {
    if (isUnread(notification)) markRead.mutate(notification.id);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={triggerLabel} className="relative">
          <Bell aria-hidden="true" />
          {unread.isError ? (
            <TriangleAlert aria-hidden="true" className="absolute -top-0.5 -right-0.5 size-3.5 text-destructive" />
          ) : unreadCount ? (
            <span
              aria-hidden="true"
              className="absolute -top-1 -right-1 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground"
            >
              {unreadBadgeText(unreadCount)}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Notificaciones</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending || !unreadCount}
          >
            <CheckCheck aria-hidden="true" />
            {markAllRead.isPending ? "Marcando…" : "Marcar todas como leídas"}
          </Button>
        </div>
        {markAllRead.isError && (
          <p role="alert" className="border-b px-4 py-2 text-sm text-destructive">
            No se pudieron marcar como leídas. {errorMessage(markAllRead.error)}
          </p>
        )}
        <div className="max-h-96 overflow-y-auto">
          <InboxBody
            query={history}
            onRetry={() => history.refetch()}
            onOpenNotification={handleOpenNotification}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function InboxBody({
  query,
  onRetry,
  onOpenNotification,
}: {
  query: { data?: Notification[]; isPending: boolean; isError: boolean; error: unknown; isFetching: boolean };
  onRetry: () => void;
  onOpenNotification: (notification: Notification) => void;
}) {
  if (query.isPending) {
    return (
      <div className="space-y-3 p-4" aria-busy="true" aria-label="Cargando notificaciones">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    );
  }
  if (query.isError && !query.data) {
    return (
      <div className="p-4">
        <ErrorNotice title="No se pudieron cargar las notificaciones" error={query.error} onRetry={onRetry} retrying={query.isFetching} />
      </div>
    );
  }
  const notifications = sortNotifications(query.data ?? []);
  if (notifications.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-muted-foreground">No hay notificaciones</p>;
  }
  return (
    <ul className="divide-y">
      {notifications.map((notification) => (
        <li key={notification.id}>
          <NotificationItem notification={notification} onOpen={() => onOpenNotification(notification)} />
        </li>
      ))}
    </ul>
  );
}

function NotificationItem({ notification, onOpen }: { notification: Notification; onOpen: () => void }) {
  const unread = isUnread(notification);
  return (
    <Link
      href={episodeHref(notification.episodeId)}
      onClick={onOpen}
      className={cn(
        "flex gap-3 px-4 py-3 text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        !unread && "text-muted-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn("mt-1.5 size-2 shrink-0 rounded-full", unread ? "bg-primary" : "bg-transparent")}
      />
      <span className="min-w-0 flex-1 space-y-1">
        {unread && <span className="sr-only">Sin leer. </span>}
        <span className={cn("block", unread && "font-medium text-foreground")}>{notification.message}</span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <StatusBadge status={NOTIFICATION_RELATED_STATUS[notification.type]} />
          <RelativeTime iso={notification.createdAt} />
        </span>
      </span>
    </Link>
  );
}
