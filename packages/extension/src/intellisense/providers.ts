import * as vscode from 'vscode';
import type { Dialect, QueryLanguage, TableInfo } from '@dbw/core';
import { genericDialect } from '@dbw/core';
import type { Dbw } from '../dbw';
import { analyze, membersOf, resolve, unquote } from './analyze';
import { statementAt } from '../query/statements';

interface EditorContext {
  dialect: Dialect;
  objects: TableInfo[];
  language?: QueryLanguage;
  keywords: string[];
  functions: string[];
  /** The runnable pieces of the document, by the language's or the dialect's rule. */
  split: (text: string) => { text: string; start: number; end: number }[];
}

/**
 * What an editor is completed against: its connection's dialect (or the
 * generic one) and schema, and its query language when it is not SQL.
 */
function contextOf(dbw: Dbw, doc: vscode.TextDocument): EditorContext {
  const profile = dbw.binding.get(doc);
  const dialect = (profile && dbw.registry.dialectFor(profile)) ?? genericDialect;
  const objects = profile ? dbw.sessions.cachedSchema(profile.id) ?? [] : [];
  const language = dbw.registry.language(doc.languageId);
  const whole = (t: string) => [{ text: t, start: 0, end: t.length }];
  return {
    dialect, objects, language,
    keywords: language?.keywords ?? dialect.keywords,
    functions: language?.functions ?? dialect.functions,
    split: language ? language.split ?? whole : dialect.split,
  };
}

export class CompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly dbw: Dbw) {}

  provideCompletionItems(doc: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    const { objects, keywords, functions, split } = contextOf(this.dbw, doc);
    const text = doc.getText();
    const offset = doc.offsetAt(position);
    const stmt = statementAt(text, offset, split);
    const local = stmt && offset >= stmt.start && offset <= stmt.end ? stmt : { text: text.slice(0, offset), start: 0 };
    const ctx = analyze(local.text, offset - local.start, objects);
    const lower = ctx.word.length > 0 && ctx.word === ctx.word.toLowerCase();
    const casing = (kw: string) => (lower ? kw.toLowerCase() : kw);
    const items: vscode.CompletionItem[] = [];
    const seen = new Set<string>();
    const add = (item: vscode.CompletionItem) => {
      const key = `${item.kind}:${item.label}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push(item);
    };

    const columns = (t: TableInfo, rank: string, withTable: boolean) => {
      for (const c of t.columns) {
        const item = new vscode.CompletionItem({ label: c.name, description: withTable ? t.name : undefined, detail: c.type ? `  ${c.type}` : undefined }, vscode.CompletionItemKind.Field);
        item.sortText = rank + c.name;
        item.detail = `${t.schema ? t.schema + '.' : ''}${t.name}.${c.name}`;
        add(item);
      }
    };
    const tables = (list: TableInfo[], rank: string) => {
      for (const t of list) {
        const item = new vscode.CompletionItem({ label: t.name, description: t.schema }, t.kind === 'view' ? vscode.CompletionItemKind.Interface : vscode.CompletionItemKind.Struct);
        item.sortText = rank + t.name;
        item.detail = `${t.kind} ${t.schema ? t.schema + '.' : ''}${t.name}`;
        item.documentation = t.columns.map((c) => `${c.name}${c.type ? ' ' + c.type : ''}`).join('\n');
        add(item);
      }
      for (const s of new Set(list.map((t) => t.schema).filter((s): s is string => Boolean(s)))) {
        const item = new vscode.CompletionItem(s, vscode.CompletionItemKind.Module);
        item.sortText = rank + '~' + s;
        item.detail = 'schema';
        add(item);
      }
    };
    const words = (list: string[], kind: vscode.CompletionItemKind, rank: string) => {
      for (const w of list) {
        const item = new vscode.CompletionItem(casing(w), kind);
        item.sortText = rank + w;
        if (kind === vscode.CompletionItemKind.Function) { item.insertText = new vscode.SnippetString(casing(w) + '($0)'); item.command = { command: 'editor.action.triggerParameterHints', title: '' }; }
        add(item);
      }
    };

    if (ctx.kind === 'member') {
      const m = membersOf(ctx.owner, ctx.scope, objects);
      if (m.columns) columns(m.columns, '0', false);
      if (m.tables) tables(m.tables, '0');
      return items;
    }
    if (ctx.kind === 'table') {
      tables(objects, '0');
      words(keywords, vscode.CompletionItemKind.Keyword, '2');
      return items;
    }
    const inScope = ctx.scope.map((s) => s.table).filter((t): t is TableInfo => Boolean(t));
    if (ctx.kind === 'column') {
      const many = inScope.length > 1;
      for (const t of inScope) columns(t, '0', many);
      for (const s of ctx.scope) {
        if (s.alias) { const item = new vscode.CompletionItem(s.alias, vscode.CompletionItemKind.Variable); item.sortText = '0' + s.alias; item.detail = `alias for ${s.raw}`; add(item); }
      }
      tables(objects, '1');
      words(functions, vscode.CompletionItemKind.Function, '2');
      words(keywords, vscode.CompletionItemKind.Keyword, '3');
      return items;
    }
    words(keywords, vscode.CompletionItemKind.Keyword, '0');
    for (const t of inScope) columns(t, '1', inScope.length > 1);
    tables(objects, '2');
    words(functions, vscode.CompletionItemKind.Function, '3');
    return items;
  }
}

export class HoverProvider implements vscode.HoverProvider {
  constructor(private readonly dbw: Dbw) {}

  provideHover(doc: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const { objects, split } = contextOf(this.dbw, doc);
    if (objects.length === 0) return undefined;
    const range = doc.getWordRangeAtPosition(position, /[A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)*/);
    if (!range) return undefined;
    const word = doc.getText(range);
    const table = resolve(word, objects);
    if (table) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**${table.kind}** \`${table.schema ? table.schema + '.' : ''}${table.name}\`\n\n`);
      md.appendMarkdown(table.columns.map((c) => `- \`${c.name}\`${c.type ? ' *' + c.type + '*' : ''}`).join('\n'));
      return new vscode.Hover(md, range);
    }
    const parts = word.split('.');
    const column = unquote(parts[parts.length - 1]).toLowerCase();
    const owner = parts.length > 1 ? parts[parts.length - 2] : undefined;
    const stmt = statementAt(doc.getText(), doc.offsetAt(position), split);
    const scope = stmt ? analyze(stmt.text, doc.offsetAt(position) - stmt.start, objects).scope : [];
    const candidates = owner ? [membersOf(owner, scope, objects).columns].filter((t): t is TableInfo => Boolean(t)) : scope.map((s) => s.table).filter((t): t is TableInfo => Boolean(t));
    for (const t of candidates) {
      const c = t.columns.find((c) => c.name.toLowerCase() === column);
      if (c) return new vscode.Hover(new vscode.MarkdownString(`**column** \`${t.name}.${c.name}\`${c.type ? ` — *${c.type}*` : ''}`), range);
    }
    return undefined;
  }
}

export class FormattingProvider implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {
  constructor(private readonly dbw: Dbw) {}

  provideDocumentFormattingEdits(doc: vscode.TextDocument): vscode.TextEdit[] {
    const whole = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
    return this.provideDocumentRangeFormattingEdits(doc, whole);
  }

  provideDocumentRangeFormattingEdits(doc: vscode.TextDocument, range: vscode.Range): vscode.TextEdit[] {
    const { dialect, language } = contextOf(this.dbw, doc);
    const format = language ? language.format : dialect.format;
    if (!format) return [];
    try {
      return [vscode.TextEdit.replace(range, format(doc.getText(range)))];
    } catch (err) {
      vscode.window.setStatusBarMessage(`dbw: cannot format: ${(err as Error).message}`, 5000);
      return [];
    }
  }
}
