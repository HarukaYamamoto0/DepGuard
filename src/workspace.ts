import * as vscode from "vscode";
import { getLatestVersionCached } from "./npmClient";

/**
 * Varre o workspace, coleta todas as deps de todos os package.json
 * (ignorando node_modules) e preenche o cache de versões em background.
 */
export async function prewarmWorkspaceDependencies(): Promise<void> {
  if (!vscode.workspace.workspaceFolders) return;

  const packageJsonFiles = await vscode.workspace.findFiles(
    "**/package.json",
    "**/node_modules/**",
    50
  );

  const depNames = new Set<string>();

  for (const uri of packageJsonFiles) {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const text = doc.getText();
      const json = JSON.parse(text);

      const deps: Record<string, string> = {
        ...(json.dependencies ?? {}),
        ...(json.devDependencies ?? {}),
      };

      for (const name of Object.keys(deps)) {
        depNames.add(name);
      }
    } catch {
      // ignora package.json inválido ou erro de IO
    }
  }

  const names = Array.from(depNames);
  if (names.length === 0) return;

  const concurrency = 5;
  let index = 0;

  async function worker() {
    while (true) {
      const i = index++;
      if (i >= names.length) break;
      const name = names[i];
      try {
        await getLatestVersionCached(name);
      } catch {
        // ignora erro individual
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
}
