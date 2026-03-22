type EventMapBase = object;

type EventHandlerResult = void | Promise<void>;

type EventHandler<TEventMap extends EventMapBase, TEvent extends keyof TEventMap> = (
  payload: TEventMap[TEvent]
) => EventHandlerResult;

export class EventEmitter<TEventMap extends EventMapBase> {
  private readonly listeners = new Map<
    keyof TEventMap,
    Set<EventHandler<TEventMap, keyof TEventMap>>
  >();

  public on<TEvent extends keyof TEventMap>(
    event: TEvent,
    handler: EventHandler<TEventMap, TEvent>
  ): () => void {
    const handlers =
      this.listeners.get(event) ?? new Set<EventHandler<TEventMap, keyof TEventMap>>();

    handlers.add(handler as EventHandler<TEventMap, keyof TEventMap>);
    this.listeners.set(event, handlers);

    return () => {
      this.off(event, handler);
    };
  }

  public off<TEvent extends keyof TEventMap>(
    event: TEvent,
    handler: EventHandler<TEventMap, TEvent>
  ): void {
    const handlers = this.listeners.get(event);
    if (!handlers) {
      return;
    }

    handlers.delete(handler as EventHandler<TEventMap, keyof TEventMap>);

    if (handlers.size === 0) {
      this.listeners.delete(event);
    }
  }

  public async emit<TEvent extends keyof TEventMap>(
    event: TEvent,
    payload: TEventMap[TEvent],
    onHandlerError?: (error: unknown, event: TEvent) => void
  ): Promise<void> {
    const handlers = this.listeners.get(event);

    if (!handlers || handlers.size === 0) {
      return;
    }

    for (const handler of handlers) {
      try {
        const result = (handler as EventHandler<TEventMap, TEvent>)(payload);
        if (isPromiseLike(result)) {
          await result;
        }
      } catch (error) {
        onHandlerError?.(error, event);
      }
    }
  }
}

function isPromiseLike(value: EventHandlerResult): value is Promise<void> {
  return typeof value === 'object' && value !== null && typeof value.then === 'function';
}
