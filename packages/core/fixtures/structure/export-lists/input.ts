function start(): string {
  return "started";
}

const port = 8080;

function internalOnly(): number {
  return port;
}

export { start, port as defaultPort };
