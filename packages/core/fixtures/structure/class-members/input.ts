/** A queue with a fixed capacity. */
export class BoundedQueue {
  private items: string[] = [];
  capacity = 8;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  /** Adds an item when there is room. */
  push(item: string): boolean {
    return this.items.length < this.capacity ? Boolean(this.items) : false;
  }

  clear = (): void => {
    this.items = [];
  };

  static describe(): string {
    return "bounded queue";
  }
}
