import { log } from "../../lib/logger";

export class Database {
  connect(): void {
    log("connected");
  }

  query(sql: string): string[] {
    return [sql];
  }
}

export const createDb = (): Database => new Database();
