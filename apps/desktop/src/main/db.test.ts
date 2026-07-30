import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalDatabaseManager } from './db';

const directories: string[] = [];

async function openDatabase() {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'smart-form-db-'));
  directories.push(directory);
  return LocalDatabaseManager.open(directory);
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(
    (directory) => fs.promises.rm(directory, { recursive: true, force: true }),
  ));
});

describe('LocalDatabaseManager', () => {
  it('persists tasks and checkpoints across restarts', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'smart-form-db-'));
    directories.push(directory);
    const database = await LocalDatabaseManager.open(directory);
    await database.saveTask({
      id: 'task-1',
      title: 'Collect orders',
      mode: 'read',
      status: 'EXPLORING',
      targetUrl: 'https://example.com/orders',
      stateVersion: 2,
      context: { page: 3 },
      createdAt: 1,
      updatedAt: 2,
    });
    await database.saveCheckpoint({
      taskId: 'task-1',
      state: 'WAITING_HUMAN',
      context: { page: 3 },
      browser: {
        url: 'https://example.com/login',
        activeTargetId: 'page-1',
      },
      sequence: 7,
      updatedAt: 3,
    });
    await database.close();

    const reopened = await LocalDatabaseManager.open(directory);
    expect(reopened.getTask('task-1')).toMatchObject({
      status: 'EXPLORING',
      stateVersion: 2,
      context: { page: 3 },
    });
    expect(reopened.getCheckpoint('task-1')).toMatchObject({
      state: 'WAITING_HUMAN',
      sequence: 7,
      browser: { activeTargetId: 'page-1' },
    });
    await reopened.close();
  });

  it('keeps outbox reports until acknowledged', async () => {
    const database = await openDatabase();
    await database.enqueueReport({
      reportId: 'report-1',
      taskId: 'task-1',
      sequence: 1,
      payload: { type: 'TASK_EVENT' },
      createdAt: 1,
    });

    expect(database.listOutbox()).toHaveLength(1);
    await database.acknowledgeReport('report-1');
    expect(database.listOutbox()).toHaveLength(0);
    await database.close();
  });

  it('persists command receipts for idempotent delivery across restarts', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'smart-form-db-'));
    directories.push(directory);
    const database = await LocalDatabaseManager.open(directory);
    await database.saveCommandReceipt({
      commandId: 'command-1',
      taskId: 'task-1',
      status: 'accepted',
      result: { accepted: true },
      updatedAt: 123,
    });
    await database.close();

    const reopened = await LocalDatabaseManager.open(directory);
    expect(reopened.getCommandReceipt('command-1')).toEqual({
      commandId: 'command-1',
      taskId: 'task-1',
      status: 'accepted',
      result: { accepted: true },
      updatedAt: 123,
    });
    await reopened.close();
  });
});
