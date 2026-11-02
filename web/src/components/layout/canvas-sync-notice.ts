export type CanvasSyncNoticeEvent = { key: string; clientId?: string; leaseResource?: string };

export function shouldShowCanvasSyncNotice(event: CanvasSyncNoticeEvent, pathname: string, currentClientId: string) {
    if (event.key !== "infinite-canvas:canvas_store" || event.clientId === currentClientId) return false;
    const match = /^\/canvas\/([^/]+)\/?$/.exec(pathname);
    if (!match) return false;
    try {
        return event.leaseResource === `canvas:${decodeURIComponent(match[1])}`;
    } catch {
        return false;
    }
}
