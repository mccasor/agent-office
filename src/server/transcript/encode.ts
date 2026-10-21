/** Come Claude Code: ogni carattere non alfanumerico diventa "-". */
export function encodeProjectPath(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}
