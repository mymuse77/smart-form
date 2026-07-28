import * as fs from 'fs';
import * as path from 'path';

export type ExportFormat = 'jsonl' | 'csv';

export class DataExporter {
  public static exportData(
    records: Record<string, any>[],
    outputPath: string,
    format: ExportFormat = 'jsonl'
  ): boolean {
    try {
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (format === 'jsonl') {
        const content = records.map((r) => JSON.stringify(r)).join('\n');
        fs.writeFileSync(outputPath, content, 'utf-8');
      } else if (format === 'csv') {
        if (records.length === 0) {
          fs.writeFileSync(outputPath, '', 'utf-8');
          return true;
        }
        const headers = Object.keys(records[0]);
        const lines = [headers.join(',')];
        records.forEach((rec) => {
          const values = headers.map((h) => {
            const val = rec[h] ?? '';
            return `"${String(val).replace(/"/g, '""')}"`;
          });
          lines.push(values.join(','));
        });
        fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
      }
      return true;
    } catch (err) {
      return false;
    }
  }
}
