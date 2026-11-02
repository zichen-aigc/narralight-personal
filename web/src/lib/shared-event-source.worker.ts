import { SharedEventBroker } from "./shared-event-source-broker";

const broker = new SharedEventBroker();
const scope = self as unknown as { onconnect: ((event: MessageEvent & { ports: MessagePort[] }) => void) | null };

scope.onconnect = (event) => broker.connect(event.ports[0]);
setInterval(() => broker.pruneInactive(Date.now() - 45_000), 20_000);

export {};
