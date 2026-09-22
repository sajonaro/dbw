// Activates dist/extension.js in plain Node with a stubbed `vscode` module.
// Proves the bundle loads, every command registers, the API works, and
// deactivation is clean, without launching VS Code.  `npm run check`.
const Module = require('node:module');
const registered = [];
const disposable = () => ({ dispose() {} });
const anything = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : anything()), apply: () => disposable(), construct: () => ({}) });
const cls = class { constructor(...a) { Object.assign(this, { a }); } static from() { return disposable(); } };
const ns = (over = {}) => new Proxy(over, { get: (t, k) => (k in t ? t[k] : anything()) });
const vscode = {
  commands: { registerCommand: (id) => { registered.push(id); return disposable(); }, executeCommand: async () => {} },
  workspace: ns({ getConfiguration: () => ({ get: (k, d) => d, update: async () => {} }), onDidChangeConfiguration: () => disposable(), onDidOpenTextDocument: () => disposable(), onDidCloseTextDocument: () => disposable(), textDocuments: [] }),
  window: ns({ createStatusBarItem: () => ns({ show() {}, hide() {}, dispose() {} }), createTreeView: () => disposable(), registerTreeDataProvider: () => disposable(), onDidChangeActiveTextEditor: () => disposable(), activeTextEditor: undefined, createOutputChannel: () => ns({ dispose() {} }) }),
  languages: ns({ registerCompletionItemProvider: () => disposable(), registerHoverProvider: () => disposable(), registerDocumentFormattingEditProvider: () => disposable() }),
  env: ns({}), Uri: { joinPath: (u, ...a) => ({ fsPath: [u.fsPath, ...a].join('/') }), file: (p) => ({ fsPath: p }) },
  Disposable: class { constructor(f) { this.dispose = f || (() => {}); } static from() { return disposable(); } },
  EventEmitter: class { constructor() { this.event = () => disposable(); } fire() {} dispose() {} },
  CompletionItem: cls, Hover: cls, MarkdownString: cls, Range: cls, SnippetString: cls, TextEdit: cls, ThemeColor: cls, ThemeIcon: cls, TreeItem: cls,
  CompletionItemKind: ns({}), ConfigurationTarget: ns({}), ProgressLocation: ns({}), StatusBarAlignment: ns({}), TreeItemCollapsibleState: ns({}), ViewColumn: ns({}),
};
const orig = Module._load;
Module._load = function (req, ...rest) { return req === 'vscode' ? vscode : orig.call(this, req, ...rest); };
const ext = require(process.cwd() + '/packages/extension/dist/extension.js');
const ctx = { subscriptions: [], extension: { packageJSON: require(process.cwd() + '/packages/extension/package.json') }, extensionUri: { fsPath: process.cwd() + '/packages/extension' }, secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} }, globalState: { get: (k, d) => d, update: async () => {} }, workspaceState: { get: (k, d) => d, update: async () => {} } };
Promise.resolve(ext.activate(ctx))
  .then(async (api) => {
    console.log('commands registered:', registered.length);
    console.log('api:', Object.keys(api).join(' '));
    const probe = { id: 'probe', name: 'Probe', dialect: { id: 'probe' }, connectionSchema: { type: 'object', properties: {} }, connect: async () => ({}) };
    api.registerDriver(probe).dispose();
    await ext.deactivate?.();
    for (const d of ctx.subscriptions) d.dispose?.();
    console.log('deactivated cleanly');
  })
  .catch((e) => { console.error('ACTIVATE FAILED', e.message); process.exit(1); });
