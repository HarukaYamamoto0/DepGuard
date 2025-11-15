import * as vscode from "vscode";
import {
  Advisory,
  AdvisorySeverity,
  getLatestVersionCached,
  getVulnerabilitiesCached,
} from "./npmClient";
import {
  SemverDiff,
  buildNewVersionText,
  cleanDeclaredVersion,
  diffSemver,
  mapDiffToSeverity,
} from "./semverUtils";

export const DIAG_SOURCE = "DepGuard";
export const DIAG_CODE_OUTDATED = "depguard.outdated";
export const DIAG_CODE_VULNERABLE = "depguard.vulnerable";

/**
 * Garante que é um package.json válido do projeto (não dentro de node_modules).
 */
export function isPackageJsonDocument(doc: vscode.TextDocument): boolean {
  const fileName = doc.fileName;
  if (!fileName.endsWith("package.json")) return false;
  if (fileName.includes("/node_modules/")) return false;
  if (fileName.includes("\\node_modules\\")) return false;
  return true;
}

/**
 * Faz o scan completo de um package.json e atualiza o DiagnosticCollection.
 * Os diagnostics vão sendo adicionados incrementalmente à medida que as
 * requisições ao npm retornam.
 */
export async function scanPackageJsonDocument(
  doc: vscode.TextDocument,
  collection: vscode.DiagnosticCollection
): Promise<void> {
  if (!isPackageJsonDocument(doc)) {
    return;
  }

  const text = doc.getText();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    collection.delete(doc.uri);
    return;
  }

  const deps: Record<string, string> = {
    ...(json.dependencies ?? {}),
    ...(json.devDependencies ?? {}),
  };

  const diagsForDoc: vscode.Diagnostic[] = [];
  collection.set(doc.uri, diagsForDoc);

  for (const [name, declaredVersion] of Object.entries(deps)) {
    scheduleChecksForDependency(
      doc,
      text,
      name,
      declaredVersion,
      diagsForDoc,
      collection
    );
  }
}

/**
 * Agenda checks de versão + vulnerabilidade para uma dependência específica.
 * Usa then/catch para manter comportamento não bloqueante.
 */
function scheduleChecksForDependency(
  doc: vscode.TextDocument,
  fullText: string,
  depName: string,
  declaredVersion: string,
  diagsForDoc: vscode.Diagnostic[],
  collection: vscode.DiagnosticCollection
) {
  const cleanCurrent = cleanDeclaredVersion(declaredVersion);

  // 1) Check de versão (outdated)
  getLatestVersionCached(depName)
    .then((latest) => {
      if (!latest) return;
      if (latest === cleanCurrent) return;
      if (doc.isClosed) return;

      const range = findVersionRange(doc, fullText, depName, declaredVersion);
      if (!range) return;

      const diff: SemverDiff = diffSemver(cleanCurrent, latest);
      const severity = mapDiffToSeverity(diff);

      const diag = new vscode.Diagnostic(
        range,
        `Newer version available (${diff}): ${declaredVersion} → ${latest}`,
        severity
      );
      diag.source = DIAG_SOURCE;
      diag.code = DIAG_CODE_OUTDATED;
      (diag as any).data = {
        pkgName: depName,
        latest,
        declaredRange: declaredVersion,
        newVersionText: buildNewVersionText(declaredVersion, latest),
      };

      diagsForDoc.push(diag);
      collection.set(doc.uri, [...diagsForDoc]);
    })
    .catch(() => {
      // ignora erro
    });

  // 2) Check de vulnerabilidades na versão atual
  getVulnerabilitiesCached(depName, cleanCurrent)
    .then((advisories) => {
      if (!advisories || advisories.length === 0) return;
      if (doc.isClosed) return;

      const range = findVersionRange(doc, fullText, depName, declaredVersion);
      if (!range) return;

      const highestSeverity = getHighestSeverity(advisories);
      const severity = mapAdvisorySeverityToDiagnostic(highestSeverity);

      const titles = advisories
        .map((a) => a.title)
        .filter(Boolean)
        .join("; ");
      const patched = advisories
        .map((a) => a.patchedVersions)
        .filter(Boolean)
        .join(", ");

      const msgParts: string[] = [];
      msgParts.push(
        `Security vulnerabilities (${highestSeverity}) found in ${depName}@${cleanCurrent}.`
      );
      if (titles) msgParts.push(titles);
      if (patched) msgParts.push(`Patched in: ${patched}`);

      const diag = new vscode.Diagnostic(range, msgParts.join(" "), severity);
      diag.source = DIAG_SOURCE;
      diag.code = DIAG_CODE_VULNERABLE;
      (diag as any).data = {
        pkgName: depName,
        version: cleanCurrent,
        advisories,
      };

      diagsForDoc.push(diag);
      collection.set(doc.uri, [...diagsForDoc]);
    })
    .catch(() => {
      // ignora erro
    });
}

/**
 * Acha o range da string de versão no texto do documento.
 *
 *  "react": "18.2.0"
 *               ^^^^^ (range)
 */
function findVersionRange(
  doc: vscode.TextDocument,
  fullText: string,
  depName: string,
  depVersion: string
): vscode.Range | null {
  const key = `"${depName}"`;
  const keyIndex = fullText.indexOf(key);
  if (keyIndex === -1) return null;

  const colonIndex = fullText.indexOf(":", keyIndex);
  if (colonIndex === -1) return null;

  const firstQuote = fullText.indexOf('"', colonIndex);
  const secondQuote = fullText.indexOf('"', firstQuote + 1);
  if (firstQuote === -1 || secondQuote === -1) return null;

  const startPos = doc.positionAt(firstQuote + 1);
  const endPos = doc.positionAt(secondQuote);

  return new vscode.Range(startPos, endPos);
}

function getHighestSeverity(advisories: Advisory[]): AdvisorySeverity {
  const order: AdvisorySeverity[] = ["low", "moderate", "high", "critical"];
  return advisories.reduce<AdvisorySeverity>(
    (acc, a) =>
      order.indexOf(a.severity) > order.indexOf(acc) ? a.severity : acc,
    "low"
  );
}

function mapAdvisorySeverityToDiagnostic(
  severity: AdvisorySeverity
): vscode.DiagnosticSeverity {
  switch (severity) {
    case "critical":
    case "high":
      return vscode.DiagnosticSeverity.Error;
    case "moderate":
      return vscode.DiagnosticSeverity.Warning;
    case "low":
      return vscode.DiagnosticSeverity.Information;
    default:
      return vscode.DiagnosticSeverity.Hint;
  }
}
