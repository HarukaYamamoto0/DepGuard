import * as vscode from 'vscode';

export type SemverDiff = 'major' | 'minor' | 'patch' | 'unknown';

export function cleanDeclaredVersion(raw: string): string {
  return raw.replace(/^[~^]/, '');
}

function parseSemver(v: string): [number, number, number] | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) {
    return null;
  }
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

export function diffSemver(current: string, latest: string): SemverDiff {
  const c = parseSemver(current);
  const l = parseSemver(latest);
  if (!c || !l) {
    return 'unknown';
  }

  if (l[0] > c[0]) {
    return 'major';
  }
  if (l[0] === c[0] && l[1] > c[1]) {
    return 'minor';
  }
  if (l[0] === c[0] && l[1] === c[1] && l[2] > c[2]) {
    return 'patch';
  }

  return 'unknown';
}

export function mapDiffToSeverity(diff: SemverDiff): vscode.DiagnosticSeverity {
  switch (diff) {
    case 'major':
      return vscode.DiagnosticSeverity.Error; // Red
    case 'minor':
      return vscode.DiagnosticSeverity.Warning; // Yellow
    case 'patch':
      return vscode.DiagnosticSeverity.Information; // Blue
    default:
      return vscode.DiagnosticSeverity.Hint;
  }
}

/**
 * Preserves ^ / ~ from the original version.
 * Ex: "^4.0.0" + "4.1.2" → "^4.1.2"
 */
export function buildNewVersionText(declaredRange: string, latest: string): string {
  const m = declaredRange.match(/^([~^])/);
  const prefix = m ? m[1] : '';
  return `${prefix}${latest}`;
}
