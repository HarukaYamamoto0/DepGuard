import * as vscode from "vscode";

let statusBarItem: vscode.StatusBarItem | undefined;
let pendingRequests = 0;

export function initStatusBar(context: vscode.ExtensionContext) {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = "depguard.scanCurrentFile";
  statusBarItem.text = "$(sync) DepGuard idle";
  statusBarItem.tooltip = "DepGuard: click to scan current package.json";
  statusBarItem.show();

  context.subscriptions.push(statusBarItem);
  updateStatusBar();
}

export function beginNetworkRequest() {
  pendingRequests++;
  updateStatusBar();
}

export function endNetworkRequest() {
  pendingRequests = Math.max(0, pendingRequests - 1);
  updateStatusBar();
}

function updateStatusBar() {
  if (!statusBarItem) {
    return;
  }

  if (pendingRequests > 0) {
    statusBarItem.text = `$(sync~spin) DepGuard checking (${pendingRequests})`;
    statusBarItem.tooltip =
      "DepGuard is checking npm for newer versions and vulnerabilities...";
    statusBarItem.show();
  } else {
    statusBarItem.text = "$(check) DepGuard ready";
    statusBarItem.tooltip = "DepGuard: dependencies checked (last run)";
    statusBarItem.show();
  }
}
