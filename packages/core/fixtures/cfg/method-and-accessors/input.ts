export class Counter {
  private value = 0;

  constructor(start: number) {
    this.value = start;
  }

  get current(): number {
    return this.value;
  }

  bump(by: number): number {
    if (by > 0) {
      this.value += by;
    }
    return this.value;
  }
}
