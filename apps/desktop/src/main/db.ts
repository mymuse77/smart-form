import * as path from 'path';
import * as fs from 'fs';

export interface LocalTaskRecord {
  id: string;
  title: string;
  mode: 'read' | 'write';
  status: string;
  targetUrl: string;
  createdAt: number;
  updatedAt: number;
}

export class LocalDatabaseManager {
  private dbPath: string;

  constructor(baseDir?: string) {
    const dir = baseDir || path.join(process.cwd(), 'data');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.dbPath = path.join(dir, 'local_agent.json');
    this.initDatabase();
  }

  private initDatabase(): void {
    if (!fs.existsSync(this.dbPath)) {
      const initialSchema = {
        tasks: [],
        events: [],
        checkpoints: [],
      };
      fs.writeFileSync(this.dbPath, JSON.stringify(initialSchema, null, 2), 'utf-8');
    }
  }

  public saveTask(task: LocalTaskRecord): void {
    const data = this.readData();
    const index = data.tasks.findIndex((t: LocalTaskRecord) => t.id === task.id);
    if (index >= 0) {
      data.tasks[index] = task;
    } else {
      data.tasks.push(task);
    }
    this.writeData(data);
  }

  public getTask(id: string): LocalTaskRecord | null {
    const data = this.readData();
    return data.tasks.find((t: LocalTaskRecord) => t.id === id) || null;
  }

  public saveEvent(eventId: string, taskId: string, type: string, payload: Record<string, unknown>): void {
    const data = this.readData();
    data.events.push({
      eventId,
      taskId,
      type,
      payload,
      timestamp: Date.now(),
    });
    this.writeData(data);
  }

  private readData(): any {
    try {
      const raw = fs.readFileSync(this.dbPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { tasks: [], events: [], checkpoints: [] };
    }
  }

  private writeData(data: any): void {
    fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
