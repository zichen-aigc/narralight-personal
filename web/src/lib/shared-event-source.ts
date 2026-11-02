import { randomId } from "@/lib/utils";

type WorkerMessage = { type: "event"; id: string; eventType: string; data: string; lastEventId?: string; owner: boolean } | { type: "open" | "error"; id: string; owner: boolean };
type SourceOptions = { eventTypes: string[]; exclusiveEvents?: string[] };

const ownerEvents = new WeakSet<Event>();
const sources = new Map<string, SharedEventSource>();
let workerPort: MessagePort | null | undefined;
let sharedListenersInstalled = false;

export function supportsSharedEventSource() {
    return typeof window !== "undefined" && typeof window.SharedWorker !== "undefined";
}

export function isSharedEventOwner(event: Event) {
    return ownerEvents.has(event);
}

function markOwner<T extends Event>(event: T, owner: boolean) {
    if (owner) ownerEvents.add(event);
    return event;
}

function activity() {
    workerPort?.postMessage({ type: "activity", visible: document.visibilityState === "visible", focused: document.hasFocus(), at: Date.now() });
}

function reconnectSharedPort() {
    workerPort?.postMessage({ type: "disconnect" });
    workerPort = undefined;
    const port = sharedPort();
    if (port) for (const source of sources.values()) source.subscribe(port);
}

function installSharedListeners() {
    if (sharedListenersInstalled) return;
    sharedListenersInstalled = true;
    window.addEventListener("focus", activity);
    window.addEventListener("blur", activity);
    document.addEventListener("visibilitychange", activity);
    window.addEventListener("pagehide", () => workerPort?.postMessage({ type: "disconnect" }));
    window.addEventListener("pageshow", (event) => { if (event.persisted) reconnectSharedPort(); });
    setInterval(activity, 15_000);
}

function sharedPort() {
    if (workerPort !== undefined) return workerPort;
    workerPort = null;
    if (!supportsSharedEventSource()) return workerPort;
    try {
        const worker = new SharedWorker(new URL("./shared-event-source.worker.ts", import.meta.url), { type: "module", name: "narralight-shared-events" });
        workerPort = worker.port;
        workerPort.onmessage = ({ data }: MessageEvent<WorkerMessage>) => sources.get(data.id)?.receive(data);
        workerPort.start();
        installSharedListeners();
        activity();
    } catch {
        workerPort = null;
    }
    return workerPort;
}

export class SharedEventSource extends EventTarget {
    onerror: ((event: Event) => void) | null = null;
    private readonly id = randomId();
    private native: EventSource | null = null;
    private closed = false;

    constructor(private readonly url: string, private readonly options: SourceOptions) {
        super();
        const port = sharedPort();
        if (port) {
            sources.set(this.id, this);
            queueMicrotask(() => {
                if (!this.closed) this.subscribe(port);
            });
            return;
        }
        this.native = new EventSource(url);
        this.native.addEventListener("open", () => this.dispatchEvent(markOwner(new Event("open"), true)));
        for (const type of options.eventTypes) this.native.addEventListener(type, (event) => this.dispatchEvent(markOwner(new MessageEvent(type, { data: (event as MessageEvent).data, lastEventId: (event as MessageEvent).lastEventId }), true)));
        this.native.onerror = () => this.fail(true);
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        this.native?.close();
        this.native = null;
        if (workerPort) workerPort.postMessage({ type: "unsubscribe", id: this.id });
        sources.delete(this.id);
    }

    subscribe(port: MessagePort) {
        port.postMessage({ type: "subscribe", id: this.id, url: this.url, eventTypes: this.options.eventTypes, exclusiveEvents: this.options.exclusiveEvents || [] });
    }

    receive(message: WorkerMessage) {
        if (this.closed) return;
        if (message.type === "event") {
            this.dispatchEvent(markOwner(new MessageEvent(message.eventType, { data: message.data, lastEventId: message.lastEventId }), message.owner));
            return;
        }
        if (message.type === "open") this.dispatchEvent(markOwner(new Event("open"), message.owner));
        else this.fail(message.owner);
    }

    private fail(owner: boolean) {
        const event = markOwner(new Event("error"), owner);
        this.onerror?.(event);
        this.dispatchEvent(event);
    }
}
