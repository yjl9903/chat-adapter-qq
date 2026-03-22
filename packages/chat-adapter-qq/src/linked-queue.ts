type QueueTask = () => Promise<void>;

interface QueueNode {
  task: QueueTask;
  next: QueueNode | null;
}

export class LinkedQueue {
  private head: QueueNode | null = null;

  private tail: QueueNode | null = null;

  private draining = false;

  private readonly onIdle?: () => void;

  public constructor(onIdle?: () => void) {
    this.onIdle = onIdle;
  }

  public get isIdle(): boolean {
    return !this.draining && this.head === null;
  }

  public enqueue(task: QueueTask): void {
    const node: QueueNode = {
      task,
      next: null
    };

    if (this.tail) {
      this.tail.next = node;
    } else {
      this.head = node;
    }

    this.tail = node;

    if (!this.draining) {
      this.draining = true;
      void this.drain();
    }
  }

  private dequeue(): QueueTask | null {
    if (!this.head) {
      return null;
    }

    const node = this.head;
    this.head = node.next;

    if (!this.head) {
      this.tail = null;
    }

    return node.task;
  }

  private async drain(): Promise<void> {
    let task: QueueTask | null;

    while ((task = this.dequeue())) {
      await task();
    }

    this.draining = false;
    this.onIdle?.();
  }
}
