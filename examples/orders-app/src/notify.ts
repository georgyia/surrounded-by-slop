export interface Notification {
  readonly to: string;
  readonly message: string;
}

export const outbox: Notification[] = [];

export function notify(to: string, message: string): void {
  // A real app would send an email; here we just record it.
  outbox.push({ to, message });
}
