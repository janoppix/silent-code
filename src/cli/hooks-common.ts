export const MARKER_START = "# >>> silent-code hook >>>";
export const MARKER_END = "# <<< silent-code hook <<<";

export function withMarkers(body: string): string {
  return `${MARKER_START}\n${body.trim()}\n${MARKER_END}`;
}

export function stripMarkedBlock(content: string): string {
  const start = content.indexOf(MARKER_START);
  const end = content.indexOf(MARKER_END);
  if (start === -1 || end === -1) return content;
  return content.slice(0, start) + content.slice(end + MARKER_END.length);
}

export function hasMarkedBlock(content: string): boolean {
  return content.includes(MARKER_START);
}
