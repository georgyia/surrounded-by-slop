/**
 * Version of the message protocol between the extension host and the webview.
 *
 * The host embeds this value in the webview bootstrap and refuses to talk to
 * a webview built against a different version — a stale webview bundle after
 * an update must fail loudly, not render a subtly wrong diagram. Bump on any
 * breaking change to a message shape.
 */
export const PROTOCOL_VERSION = 1;
