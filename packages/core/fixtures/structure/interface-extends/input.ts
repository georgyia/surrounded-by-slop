export interface Identified {
  id: string;
}

export interface Timestamped {
  at: number;
}

export interface Event extends Identified, Timestamped {
  name: string;
}

export class LogEvent implements Event {
  id = "";
  at = 0;
  name = "log";
}
