import * as vscode from 'vscode';
import type { QueryResult } from '@dbw/core';
import { toGrid } from './serialize';
import type { FromWebview, ToWebview } from './protocol';

/**
 * The results panels, one per editor, reused for every run: a grid per
 * result set and a messages tab, beside the editor.  A service, so that
 * the runner is given it rather than reaching
 * for it, and so that deactivation closes what is open.
 */
export class Results implements vscode.Disposable {
  private readonly panels = new Map<string, ResultsPanel>();

  constructor(private readonly extensionUri: vscode.Uri) {}

  for(doc: vscode.TextDocument): ResultsPanel {
    const key = doc.uri.toString();
    let panel = this.panels.get(key);
    if (!panel) {
      panel = new ResultsPanel(doc, this.extensionUri, () => this.panels.delete(key));
      this.panels.set(key, panel);
    }
    return panel;
  }

  existing(doc: vscode.TextDocument): ResultsPanel | undefined {
    return this.panels.get(doc.uri.toString());
  }

  dispose(): void {
    for (const p of this.panels.values()) p.dispose();
    this.panels.clear();
  }
}

export class ResultsPanel implements vscode.Disposable {
  private readonly panel: vscode.WebviewPanel;
  private last: ToWebview | undefined;

  constructor(doc: vscode.TextDocument, extensionUri: vscode.Uri, onDispose: () => void) {
    const name = doc.isUntitled ? doc.uri.path.replace(/^\//, '') : doc.fileName.split(/[\\/]/).pop();
    this.panel = vscode.window.createWebviewPanel('dbw.results', `Results: ${name}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'media')],
    });
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'dbw.svg');
    this.panel.webview.html = html(this.panel.webview, extensionUri);
    this.panel.webview.onDidReceiveMessage((m: FromWebview) => this.onMessage(m));
    this.panel.onDidDispose(onDispose);
  }

  reveal(): void {
    this.panel.reveal(undefined, true);
  }

  running(sql: string): void {
    this.post({ type: 'running', sql });
  }

  show(sql: string, results: QueryResult[], connection: string): void {
    const max = vscode.workspace.getConfiguration('dbw').get<number>('maxRowsShown', 10000);
    this.post({ type: 'results', sql, results: results.map((r) => toGrid(r, max)), connection });
  }

  error(sql: string, message: string, connection: string): void {
    this.post({ type: 'error', sql, message, connection });
  }

  dispose(): void {
    this.panel.dispose();
  }

  private post(message: ToWebview): void {
    this.last = message;
    this.panel.reveal(undefined, true);
    void this.panel.webview.postMessage(message);
  }

  private async onMessage(m: FromWebview): Promise<void> {
    if (m.type === 'ready') {
      if (this.last) void this.panel.webview.postMessage(this.last);
    } else if (m.type === 'copy') {
      await vscode.env.clipboard.writeText(m.text);
      vscode.window.setStatusBarMessage('dbw: copied', 2000);
    } else if (m.type === 'save') {
      const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(m.name), filters: { 'CSV': ['csv'], 'JSON': ['json'], 'All files': ['*'] } });
      if (!target) return;
      await vscode.workspace.fs.writeFile(target, Buffer.from(m.text, 'utf8'));
      vscode.window.showInformationMessage(`dbw: saved ${target.fsPath}`);
    }
  }
}

function html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'media', 'results.js'));
  const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dbw results</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
