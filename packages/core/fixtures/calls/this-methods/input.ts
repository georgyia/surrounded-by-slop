export class Machine {
  start(): void {
    this.reset();
  }

  reset(): void {
    this.log = "";
  }

  private log = "";
}
