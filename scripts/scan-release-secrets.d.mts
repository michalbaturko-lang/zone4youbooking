export interface ReleaseSecretScanIssue {
  rule: string;
  path: string;
  source: string;
}

export interface ReleaseSecretScanResult {
  ok: boolean;
  checkedAt: string;
  currentFileCount: number;
  historyBlobCount: number;
  historyIncluded: boolean;
  issues: ReleaseSecretScanIssue[];
}

export function scanRepositorySecrets(options?: {
  repositoryRoot?: string;
  includeHistory?: boolean;
}): ReleaseSecretScanResult;
