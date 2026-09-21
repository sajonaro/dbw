import * as vscode from 'vscode';
import type { Dbw, Feature } from '../dbw';
import { collect } from '../connections/form';
import { newId, secretFields, type Profile } from '../connections/store';
import type { Element } from '../explorer';

/** Adding, editing, removing, opening and closing connections. */
export const connectionsFeature: Feature = (dbw) => vscode.Disposable.from(
  vscode.commands.registerCommand('dbw.addConnection', () => addConnection(dbw)),
  vscode.commands.registerCommand('dbw.editConnection', (e?: Element) => editConnection(dbw, profileOf(dbw, e))),
  vscode.commands.registerCommand('dbw.removeConnection', (e?: Element) => removeConnection(dbw, profileOf(dbw, e))),
  vscode.commands.registerCommand('dbw.connect', async (e?: Element) => {
    const profile = await pick(dbw, profileOf(dbw, e));
    if (!profile) return;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `dbw: connecting to ${profile.name}` }, async () => {
      try { await dbw.sessions.get(profile); } catch (err) { vscode.window.showErrorMessage(`dbw: ${profile.name}: ${(err as Error).message}`); }
    });
  }),
  vscode.commands.registerCommand('dbw.disconnect', async (e?: Element) => {
    const profile = await pick(dbw, profileOf(dbw, e));
    if (profile) await dbw.sessions.close(profile.id);
  }),
);

function profileOf(dbw: Dbw, e?: Element): Profile | undefined {
  return e && e.type !== 'error' ? dbw.profiles.get(e.profile.id) : undefined;
}

async function pick(dbw: Dbw, profile?: Profile): Promise<Profile | undefined> {
  if (profile) return profile;
  const picked = await vscode.window.showQuickPick(dbw.profiles.list().map((p) => ({ label: p.name, description: p.driver, p })), { placeHolder: 'Connection' });
  return picked?.p;
}

async function addConnection(dbw: Dbw): Promise<void> {
  const drivers = dbw.registry.allDrivers();
  if (drivers.length === 0) {
    vscode.window.showErrorMessage('dbw: no drivers are registered.');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    drivers.map((d) => ({ label: d.name, description: d.id, detail: d.description, driver: d })),
    { placeHolder: 'Which kind of database?', title: 'New connection' },
  );
  if (!picked) return;
  const form = await collect(dbw.registry, picked.driver);
  if (!form) return;
  const profile: Profile = { id: newId(), name: form.name, driver: picked.driver.id, config: form.config };
  if (!(await verify(dbw, profile, form.secrets))) return;
  await dbw.profiles.save(profile, form.secrets);
  vscode.window.showInformationMessage(`dbw: saved ${profile.name}`);
}

async function editConnection(dbw: Dbw, profile?: Profile): Promise<void> {
  profile = await pick(dbw, profile);
  if (!profile) return;
  const driver = dbw.registry.driver(profile.driver);
  if (!driver) { vscode.window.showErrorMessage(`dbw: no driver '${profile.driver}' is registered.`); return; }
  const secrets: Record<string, string> = {};
  for (const f of secretFields(driver)) secrets[f] = (await dbw.profiles.secret(profile, f)) ?? '';
  const form = await collect(dbw.registry, driver, { profile, secrets });
  if (!form) return;
  const updated: Profile = { ...profile, name: form.name, config: form.config };
  if (!(await verify(dbw, updated, form.secrets))) return;
  await dbw.sessions.close(profile.id);
  await dbw.profiles.save(updated, form.secrets);
}

async function removeConnection(dbw: Dbw, profile?: Profile): Promise<void> {
  profile = await pick(dbw, profile);
  if (!profile) return;
  const answer = await vscode.window.showWarningMessage(`Remove connection '${profile.name}'?`, { modal: true }, 'Remove');
  if (answer !== 'Remove') return;
  await dbw.sessions.close(profile.id);
  await dbw.profiles.remove(profile, dbw.registry.driver(profile.driver));
}

/** Try the connection before saving it; a failure is a choice, not a wall. */
async function verify(dbw: Dbw, profile: Profile, secrets: Record<string, string>): Promise<boolean> {
  const driver = dbw.registry.driver(profile.driver)!;
  const error = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `dbw: testing ${profile.name}` }, async () => {
    try {
      const conn = await driver.connect({ ...profile.config, ...secrets });
      await conn.close();
      return undefined;
    } catch (err) {
      return (err as Error).message;
    }
  });
  if (!error) return true;
  const answer = await vscode.window.showWarningMessage(`Could not connect: ${error}`, { modal: true }, 'Save anyway');
  return answer === 'Save anyway';
}
