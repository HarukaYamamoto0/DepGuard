import * as vscode from 'vscode';
import { DIAG_CODE_OUTDATED, DIAG_SOURCE } from './diagnostics';
import { buildNewVersionText } from './semverUtils';

export class PackageVersionCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diag of context.diagnostics) {
      if (diag.source !== DIAG_SOURCE || diag.code !== DIAG_CODE_OUTDATED) {
        continue;
      }

      const data = (diag as any).data as
        | {
            pkgName: string;
            latest: string;
            declaredRange: string;
            newVersionText?: string;
          }
        | undefined;

      if (!data) {
        continue;
      }

      const newVersionText = data.newVersionText ?? buildNewVersionText(data.declaredRange, data.latest);

      const action = new vscode.CodeAction(
        `Update ${data.pkgName} to ${newVersionText}`,
        vscode.CodeActionKind.QuickFix,
      );
      action.diagnostics = [diag];
      action.isPreferred = true;

      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, diag.range, newVersionText);
      action.edit = edit;

      actions.push(action);
    }

    return actions;
  }
}
