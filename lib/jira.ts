export interface JiraIssue {
  key: string;
  url: string;
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

    return { key: match[1].toUpperCase(), url: url.origin + url.pathname };
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
