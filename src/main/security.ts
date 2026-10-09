export const APP_URL = 'codebase://app/index.html';
export function trustedSender(senderId: number, windowId: number, isMainFrame: boolean, url: string): boolean {
  return senderId === windowId && isMainFrame && url === APP_URL;
}
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
