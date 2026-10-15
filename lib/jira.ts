export interface JiraIssue {
  key: string;
  url: string;
  summary?: string;
}

function issueSummaryFromTabTitle(tabTitle: string, key: string): string | undefined {
  const title = tabTitle
    .trim()
    .replace(/\s*[-–—|]\s*Jira\s*$/i, '')
    .trim();
  const atStart = title.match(new RegExp(`^${key}(?:\\s*[-–—:|]\\s*|\\s+)(.+)$`, 'i'));
  const atEnd = title.match(new RegExp(`^(.+?)(?:\\s*[-–—:|]\\s*|\\s+)${key}$`, 'i'));
  const summary = (atStart?.[1] ?? atEnd?.[1])?.trim();

  return summary || undefined;
}

export function jiraIssueFromUrl(value: string | undefined, tabTitle = ''): JiraIssue | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

    const match = url.pathname.match(/\/(?:browse|issues)\/([A-Z][A-Z0-9_]*-\d+)(?:\/|$)/i);
    if (!match) return null;

    const isJiraHost =
      url.hostname.endsWith('.atlassian.net') || /(^|[.-])jira([.-]|$)/i.test(url.hostname);
    if (!isJiraHost && !/\bjira\b/i.test(tabTitle)) return null;

    const key = match[1].toUpperCase();
    const summary = issueSummaryFromTabTitle(tabTitle, key);

    return { key, url: url.origin + url.pathname, ...(summary ? { summary } : {}) };
  } catch {
    return null;
  }
}

export function titleWithJiraKey(title: string, key: string): string {
  const trimmed = title.trim();
  return new RegExp(`(^|\\W)${key}(\\W|$)`, 'i').test(trimmed)
    ? trimmed
    : `${key}${trimmed ? ` ${trimmed}` : ''}`.slice(0, 2000);
}
