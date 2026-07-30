import * as fs from 'node:fs';
import * as path from 'node:path';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import writeFileAtomic from 'write-file-atomic';

export interface LocalTaskRecord {
  id: string;
  title: string;
  mode: 'read' | 'write';
  status: string;
  targetUrl: string;
  context?: Record<string, unknown>;
  stateVersion?: number;
  createdAt: number;
  updatedAt: number;
}

export interface TaskCheckpointRecord {
  taskId: string;
  state: string;
  context: Record<string, unknown>;
  browser: {
    url: string;
    title?: string;
    fingerprint?: string;
    activeTargetId?: string;
  };
  sequence: number;
  updatedAt: number;
}

export interface OutboxRecord {
  reportId: string;
  taskId?: string;
  sequence: number;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface CommandReceiptRecord {
  commandId: string;
  taskId: string;
  status: 'processing' | 'accepted' | 'rejected';
  result: Record<string, unknown>;
  updatedAt: number;
}

export class LocalDatabaseManager {
  private constructor(
    private readonly dbPath: string,
    private readonly database: Database,
  ) {}

  static async open(baseDir?: string): Promise<LocalDatabaseManager> {
    const directory = baseDir ?? path.join(process.cwd(), 'data');
    await fs.promises.mkdir(directory, { recursive: true });
    const dbPath = path.join(directory, 'local-agent.sqlite');
    const SQL: SqlJsStatic = await initSqlJs({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
    });
    const existing = await fs.promises.readFile(dbPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    const database = existing ? new SQL.Database(existing) : new SQL.Database();
    const manager = new LocalDatabaseManager(dbPath, database);
    manager.migrate();
    await manager.persist();
    return manager;
  }

  private migrate(): void {
    this.database.run('PRAGMA foreign_keys = ON;');
    this.database.run(`
      CREATE TABLE IF NOT EXISTS local_tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('read', 'write')),
        status TEXT NOT NULL,
        target_url TEXT NOT NULL,
        context_json TEXT NOT NULL,
        state_version INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_events (
        event_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        UNIQUE(task_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        task_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        context_json TEXT NOT NULL,
        browser_json TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outbox (
        report_id TEXT PRIMARY KEY,
        task_id TEXT,
        sequence INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS command_receipts (
        command_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('processing', 'accepted', 'rejected')),
        result_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_events_task_sequence
        ON task_events(task_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_outbox_sequence
        ON outbox(sequence);
    `);
  }

  async saveTask(task: LocalTaskRecord): Promise<void> {
    this.database.run(`
      INSERT INTO local_tasks (
        id, title, mode, status, target_url, context_json,
        state_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        mode = excluded.mode,
        status = excluded.status,
        target_url = excluded.target_url,
        context_json = excluded.context_json,
        state_version = excluded.state_version,
        updated_at = excluded.updated_at
    `, [
      task.id,
      task.title,
      task.mode,
      task.status,
      task.targetUrl,
      JSON.stringify(task.context ?? {}),
      task.stateVersion ?? 0,
      task.createdAt,
      task.updatedAt,
    ]);
    await this.persist();
  }

  getTask(id: string): LocalTaskRecord | null {
    const rows = this.database.exec(`
      SELECT id, title, mode, status, target_url, context_json,
             state_version, created_at, updated_at
      FROM local_tasks WHERE id = ?
    `, [id]);
    if (rows.length === 0 || rows[0]!.values.length === 0) return null;
    const row = rows[0]!.values[0]!;
    return {
      id: String(row[0]),
      title: String(row[1]),
      mode: String(row[2]) as 'read' | 'write',
      status: String(row[3]),
      targetUrl: String(row[4]),
      context: JSON.parse(String(row[5])) as Record<string, unknown>,
      stateVersion: Number(row[6]),
      createdAt: Number(row[7]),
      updatedAt: Number(row[8]),
    };
  }

  async appendEvent(
    eventId: string,
    taskId: string,
    sequence: number,
    type: string,
    payload: Record<string, unknown>,
    timestamp = Date.now(),
  ): Promise<void> {
    this.database.run(`
      INSERT INTO task_events (
        event_id, task_id, sequence, type, payload_json, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [eventId, taskId, sequence, type, JSON.stringify(payload), timestamp]);
    await this.persist();
  }

  async saveCheckpoint(checkpoint: TaskCheckpointRecord): Promise<void> {
    this.database.run('BEGIN IMMEDIATE TRANSACTION;');
    try {
      this.database.run(`
        INSERT INTO checkpoints (
          task_id, state, context_json, browser_json, sequence, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          state = excluded.state,
          context_json = excluded.context_json,
          browser_json = excluded.browser_json,
          sequence = excluded.sequence,
          updated_at = excluded.updated_at
        WHERE excluded.sequence >= checkpoints.sequence
      `, [
        checkpoint.taskId,
        checkpoint.state,
        JSON.stringify(checkpoint.context),
        JSON.stringify(checkpoint.browser),
        checkpoint.sequence,
        checkpoint.updatedAt,
      ]);
      this.database.run('COMMIT;');
    } catch (error) {
      this.database.run('ROLLBACK;');
      throw error;
    }
    await this.persist();
  }

  getCheckpoint(taskId: string): TaskCheckpointRecord | null {
    const rows = this.database.exec(`
      SELECT task_id, state, context_json, browser_json, sequence, updated_at
      FROM checkpoints WHERE task_id = ?
    `, [taskId]);
    if (rows.length === 0 || rows[0]!.values.length === 0) return null;
    const row = rows[0]!.values[0]!;
    return {
      taskId: String(row[0]),
      state: String(row[1]),
      context: JSON.parse(String(row[2])) as Record<string, unknown>,
      browser: JSON.parse(String(row[3])) as TaskCheckpointRecord['browser'],
      sequence: Number(row[4]),
      updatedAt: Number(row[5]),
    };
  }

  async enqueueReport(report: OutboxRecord): Promise<void> {
    this.database.run(`
      INSERT OR IGNORE INTO outbox (
        report_id, task_id, sequence, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `, [
      report.reportId,
      report.taskId ?? null,
      report.sequence,
      JSON.stringify(report.payload),
      report.createdAt,
    ]);
    await this.persist();
  }

  listOutbox(limit = 100): OutboxRecord[] {
    const safeLimit = Math.max(1, Math.min(limit, 1_000));
    const rows = this.database.exec(`
      SELECT report_id, task_id, sequence, payload_json, created_at
      FROM outbox ORDER BY sequence ASC LIMIT ${safeLimit}
    `);
    if (rows.length === 0) return [];
    return rows[0]!.values.map((row) => ({
      reportId: String(row[0]),
      taskId: row[1] === null ? undefined : String(row[1]),
      sequence: Number(row[2]),
      payload: JSON.parse(String(row[3])) as Record<string, unknown>,
      createdAt: Number(row[4]),
    }));
  }

  async acknowledgeReport(reportId: string): Promise<void> {
    this.database.run('DELETE FROM outbox WHERE report_id = ?', [reportId]);
    await this.persist();
  }

  getCommandReceipt(commandId: string): CommandReceiptRecord | null {
    const rows = this.database.exec(`
      SELECT command_id, task_id, status, result_json, updated_at
      FROM command_receipts WHERE command_id = ?
    `, [commandId]);
    if (rows.length === 0 || rows[0]!.values.length === 0) return null;
    const row = rows[0]!.values[0]!;
    return {
      commandId: String(row[0]),
      taskId: String(row[1]),
      status: String(row[2]) as CommandReceiptRecord['status'],
      result: JSON.parse(String(row[3])) as Record<string, unknown>,
      updatedAt: Number(row[4]),
    };
  }

  async saveCommandReceipt(receipt: CommandReceiptRecord): Promise<void> {
    this.database.run(`
      INSERT INTO command_receipts (
        command_id, task_id, status, result_json, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(command_id) DO UPDATE SET
        status = excluded.status,
        result_json = excluded.result_json,
        updated_at = excluded.updated_at
    `, [
      receipt.commandId,
      receipt.taskId,
      receipt.status,
      JSON.stringify(receipt.result),
      receipt.updatedAt,
    ]);
    await this.persist();
  }

  async close(): Promise<void> {
    await this.persist();
    this.database.close();
  }

  private async persist(): Promise<void> {
    await writeFileAtomic(this.dbPath, Buffer.from(this.database.export()), {
      fsync: true,
    });
  }
}
