import * as vscode from 'vscode';
import type { DriverPlugin, PropertySchema } from '@dbw/core';
import type { Registry } from '../registry';
import { secretFields, type Profile } from './store';

export interface FormResult {
  name: string;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
}

/**
 * The connection form, one question at a time, from the driver's schema.
 * A driver describes its fields; nothing here knows what a host or a
 * database file is.
 */
export async function collect(
  registry: Registry,
  driver: DriverPlugin,
  existing?: { profile: Profile; secrets: Record<string, string> },
): Promise<FormResult | undefined> {
  const schema = driver.connectionSchema;
  const fields = Object.entries(schema.properties);
  const required = new Set(schema.required ?? []);
  const total = fields.length + 1;
  let step = 1;
  const title = existing ? `Edit connection: ${existing.profile.name}` : `New ${driver.name} connection`;

  const name = await ask({
    title, step: step++, total,
    prompt: 'A name for this connection',
    value: existing?.profile.name ?? driver.name,
    validate: (v) => (v.trim() ? undefined : 'A connection needs a name'),
  });
  if (name === undefined) return undefined;

  const config: Record<string, unknown> = {};
  const secrets: Record<string, string> = {};
  const secretNames = new Set(secretFields(driver));

  for (const [key, prop] of fields) {
    const current = secretNames.has(key) ? existing?.secrets[key] : existing?.profile.config[key];
    const value = await askProperty(key, prop, current ?? prop.default, { title, step: step++, total, required: required.has(key) });
    if (value === undefined) return undefined;
    if (secretNames.has(key)) secrets[key] = String(value);
    else if (value !== '') config[key] = value;
  }

  // A generic driver lets the connection say which dialect it speaks.
  if ('dialect' in schema.properties && typeof config.dialect === 'string' && !registry.allDialects().some((d) => d.id === config.dialect)) {
    vscode.window.showWarningMessage(`No dialect named '${config.dialect}' is registered; the driver's own will be used.`);
  }

  return { name: name.trim(), config, secrets };
}

interface Step {
  title: string;
  step: number;
  total: number;
  required?: boolean;
}

async function askProperty(key: string, prop: PropertySchema, current: unknown, s: Step): Promise<unknown> {
  const label = prop.title ?? key;
  if (prop.type === 'boolean') {
    const picked = await vscode.window.showQuickPick(
      [{ label: 'Yes', value: true }, { label: 'No', value: false }].sort((a) => (a.value === Boolean(current) ? -1 : 1)),
      { title: `${s.title} (${s.step}/${s.total})`, placeHolder: label + (prop.description ? ` — ${prop.description}` : '') },
    );
    return picked?.value;
  }
  if (prop.enum) {
    const picked = await vscode.window.showQuickPick(
      prop.enum.map((v) => ({ label: v, picked: v === current })),
      { title: `${s.title} (${s.step}/${s.total})`, placeHolder: label },
    );
    return picked?.label;
  }
  const isNumber = prop.type === 'number' || prop.type === 'integer';
  const text = await ask({
    title: s.title, step: s.step, total: s.total,
    prompt: label + (prop.description ? ` — ${prop.description}` : '') + (s.required ? '' : ' (optional)'),
    value: current === undefined || current === null ? '' : String(current),
    password: prop.format === 'password',
    browse: prop.format === 'file',
    validate: (v) => {
      if (!v.trim()) return s.required ? `${label} is required` : undefined;
      if (isNumber && !/^-?\d+(\.\d+)?$/.test(v.trim())) return `${label} must be a number`;
      return undefined;
    },
  });
  if (text === undefined) return undefined;
  if (text.trim() === '') return '';
  return isNumber ? Number(text.trim()) : text;
}

interface Ask {
  title: string;
  step: number;
  total: number;
  prompt: string;
  value: string;
  password?: boolean;
  browse?: boolean;
  validate: (v: string) => string | undefined;
}

/** One input box, with a Browse button when the value is a file. */
function ask(a: Ask): Promise<string | undefined> {
  return new Promise((resolve) => {
    const box = vscode.window.createInputBox();
    box.title = a.title;
    box.step = a.step;
    box.totalSteps = a.total;
    box.prompt = a.prompt;
    box.value = a.value;
    box.password = Boolean(a.password);
    box.ignoreFocusOut = true;
    const browse: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('folder-opened'), tooltip: 'Browse…' };
    if (a.browse) box.buttons = [browse];
    let done = false;
    const finish = (v: string | undefined) => { if (!done) { done = true; resolve(v); box.dispose(); } };
    box.onDidChangeValue((v) => { box.validationMessage = a.validate(v); });
    box.onDidAccept(() => { if (!a.validate(box.value)) finish(box.value); });
    box.onDidTriggerButton(async () => {
      const picked = await vscode.window.showOpenDialog({ canSelectMany: false, title: a.prompt });
      if (picked?.[0]) box.value = picked[0].fsPath;
      box.show();
    });
    box.onDidHide(() => finish(undefined));
    box.show();
  });
}
