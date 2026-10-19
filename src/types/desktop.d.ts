export interface DesktopWorkspace { root: string; name: string }
export interface DesktopEntry { name: string; path: string; directory: boolean }
export interface DesktopFile { text: string; hash: string }
export interface DesktopAPI {
  chooseFolder(): Promise<DesktopWorkspace | null>;
  list(request: { workspace: string; relative?: string }): Promise<DesktopEntry[]>;
  read(request: { workspace: string; relative: string }): Promise<DesktopFile>;
  save(request: { workspace: string; relative: string; text: string; hash: string }): Promise<DesktopFile>;
  create(request: { workspace: string; relative: string; directory?: boolean }): Promise<void>;
  setDirty(dirty: boolean): void;
}
declare global { interface Window { desktop?: DesktopAPI } }
