type PortMessage =
    | { type: "subscribe"; id: string; url: string; eventTypes: string[]; exclusiveEvents: string[] }
    | { type: "unsubscribe"; id: string }
    | { type: "activity"; visible: boolean; focused: boolean; at: number }
    | { type: "disconnect" };

type BrokerPort = Pick<MessagePort, "postMessage" | "start"> & { onmessage: ((event: MessageEvent<PortMessage>) => void) | null };
type EventSourceLike = Pick<EventSource, "addEventListener" | "close">;
type Subscription = { id: string; port: BrokerPort; url: string; eventTypes: Set<string>; exclusiveEvents: Set<string> };
type PortState = { visible: boolean; focused: boolean; at: number };
type Stream = { source: EventSourceLike; subscriptions: Set<Subscription>; listeners: Set<string>; opened: boolean; cached: Map<string, { data: string; lastEventId: string }> };

export class SharedEventBroker {
    private readonly ports = new Map<BrokerPort, PortState>();
    private readonly subscriptions = new Map<string, Subscription>();
    private readonly streams = new Map<string, Stream>();

    constructor(private readonly createEventSource: (url: string) => EventSourceLike = (url) => new EventSource(url)) {}

    connect(port: BrokerPort) {
        this.ports.set(port, { visible: true, focused: false, at: Date.now() });
        port.onmessage = (event) => this.receive(port, event.data);
        port.start();
    }

    pruneInactive(before: number) {
        for (const [port, state] of this.ports) if (state.at < before) this.disconnect(port);
    }

    private receive(port: BrokerPort, message: PortMessage) {
        const state = this.ports.get(port);
        if (!state) return;
        state.at = Date.now();
        if (message.type === "activity") {
            Object.assign(state, { visible: message.visible, focused: message.focused, at: message.at });
            return;
        }
        if (message.type === "disconnect") return this.disconnect(port);
        if (message.type === "unsubscribe") return this.unsubscribe(message.id);
        this.subscribe(port, message);
    }

    private subscribe(port: BrokerPort, message: Extract<PortMessage, { type: "subscribe" }>) {
        this.unsubscribe(message.id);
        let stream = this.streams.get(message.url);
        if (!stream) {
            const source = this.createEventSource(message.url);
            stream = { source, subscriptions: new Set(), listeners: new Set(), opened: false, cached: new Map() };
            this.streams.set(message.url, stream);
            source.addEventListener("open", () => {
                stream!.opened = true;
                this.broadcastStatus(stream!, "open");
            });
            source.addEventListener("error", () => this.broadcastStatus(stream!, "error"));
        }
        const subscription: Subscription = { id: message.id, port, url: message.url, eventTypes: new Set(message.eventTypes), exclusiveEvents: new Set(message.exclusiveEvents) };
        stream.subscriptions.add(subscription);
        this.subscriptions.set(message.id, subscription);
        for (const type of subscription.eventTypes) this.ensureListener(stream, type);
        if (stream.opened) this.post(subscription, { type: "open", id: subscription.id, owner: this.owner(stream) === port });
        for (const type of subscription.eventTypes) {
            const cached = stream.cached.get(type);
            if (cached) this.postEvent(stream, subscription, type, cached.data, cached.lastEventId);
        }
    }

    private ensureListener(stream: Stream, type: string) {
        if (stream.listeners.has(type)) return;
        stream.listeners.add(type);
        stream.source.addEventListener(type, (event) => {
            const message = event as MessageEvent;
            const data = String(message.data ?? "");
            const lastEventId = String(message.lastEventId || "");
            if (type === "hello") stream.cached.set(type, { data, lastEventId });
            for (const subscription of stream.subscriptions) if (subscription.eventTypes.has(type)) this.postEvent(stream, subscription, type, data, lastEventId);
        });
    }

    private postEvent(stream: Stream, subscription: Subscription, eventType: string, data: string, lastEventId: string) {
        const owner = this.owner(stream);
        if (subscription.exclusiveEvents.has(eventType) && owner !== subscription.port) return;
        this.post(subscription, { type: "event", id: subscription.id, eventType, data, lastEventId, owner: owner === subscription.port });
    }

    private broadcastStatus(stream: Stream, type: "open" | "error") {
        const owner = this.owner(stream);
        for (const subscription of stream.subscriptions) this.post(subscription, { type, id: subscription.id, owner: owner === subscription.port });
    }

    private owner(stream: Stream) {
        return [...new Set([...stream.subscriptions].map(({ port }) => port))].sort((left, right) => this.rank(right) - this.rank(left))[0];
    }

    private rank(port: BrokerPort) {
        const state = this.ports.get(port);
        return state ? (state.focused && state.visible ? 2e15 : state.visible ? 1e15 : 0) + state.at : 0;
    }

    private post(subscription: Subscription, message: Record<string, unknown>) {
        subscription.port.postMessage(message);
    }

    private unsubscribe(id: string) {
        const subscription = this.subscriptions.get(id);
        if (!subscription) return;
        this.subscriptions.delete(id);
        const stream = this.streams.get(subscription.url);
        stream?.subscriptions.delete(subscription);
        if (stream && !stream.subscriptions.size) {
            stream.source.close();
            this.streams.delete(subscription.url);
        }
    }

    private disconnect(port: BrokerPort) {
        for (const subscription of [...this.subscriptions.values()]) if (subscription.port === port) this.unsubscribe(subscription.id);
        this.ports.delete(port);
        port.onmessage = null;
    }
}
