declare const mystery: { anything: unknown };

export function tryEverything(): void {
  phantom();
  (mystery.anything as () => void)();
}
