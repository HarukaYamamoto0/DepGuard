import * as vscode from 'vscode';
import { initStatusBar } from './activity';
import { DIAG_SOURCE, isPackageJsonDocument, scanPackageJsonDocument } from './diagnostics';
import { clearCaches } from './npmClient';
import { prewarmWorkspaceDependencies } from './workspace';
import { PackageVersionCodeActionProvider } from './codeActions';

export function activate(context: vscode.ExtensionContext) {
  const diagnostics = vscode.languages.createDiagnosticCollection(DIAG_SOURCE);
  context.subscriptions.push(diagnostics);

  // Status bar (DepGuard)
  initStatusBar(context);

  // Prewarm em background
  prewarmWorkspaceDependencies().catch(() => {});

  async function scan(doc: vscode.TextDocument) {
    await scanPackageJsonDocument(doc, diagnostics);
  }

  // Listen, open/save
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (isPackageJsonDocument(doc)) {
        scan(doc);
      }
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (isPackageJsonDocument(doc)) {
        scan(doc);
      }
    }),
  );

  // Initial scan of the open file.
  if (vscode.window.activeTextEditor && isPackageJsonDocument(vscode.window.activeTextEditor.document)) {
    scan(vscode.window.activeTextEditor.document);
  }

  // Manual control (Command Palette)
  const cmd = vscode.commands.registerCommand('depguard.scanCurrentFile', () => {
    const editor = vscode.window.activeTextEditor;
    if (editor && isPackageJsonDocument(editor.document)) {
      scan(editor.document);
    }
  });
  context.subscriptions.push(cmd);

  // CodeActions (Quick Fix)
  const codeActionProvider = new PackageVersionCodeActionProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      [
        { language: 'json', scheme: 'file' },
        { language: 'jsonc', scheme: 'file' },
      ],
      codeActionProvider,
      {
        providedCodeActionKinds: PackageVersionCodeActionProvider.providedCodeActionKinds,
      },
    ),
  );

  // Periodic Rescan every 30min
  const intervalMs = 30 * 60 * 1000;
  const timer = setInterval(() => {
    clearCaches();
    prewarmWorkspaceDependencies().catch(() => {});

    vscode.workspace.textDocuments.filter(isPackageJsonDocument).forEach((d) => {
      scan(d);
    });
  }, intervalMs);

  context.subscriptions.push({
    dispose: () => clearInterval(timer),
  });
}

export function deactivate() {
  // Nothing specific for now.
}
