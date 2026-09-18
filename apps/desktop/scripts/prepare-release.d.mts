export function prepareDesktopRelease(options: {
  tag: string;
  sha: string;
  notes: string;
  requireExisting?: boolean;
  api: (path: string, method?: string, body?: unknown) => Promise<unknown>;
}): Promise<number>;
