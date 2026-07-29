import { DataSource, DataSourceField, DataSourceSchema } from './types';

export class DataSourceParser {
  /**
   * 从 JSON 文本解析生成 DataSource
   */
  public static parseFromJSON(jsonStr: string, name: string = '自定义数据源'): DataSource {
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const sample = parsed[0];
        const fields: DataSourceField[] = Object.keys(sample).map((key) => ({
          key,
          label: key,
          type: typeof sample[key] === 'number' ? 'number' : 'string',
          sensitive: key.toLowerCase().includes('secret') || key.toLowerCase().includes('password'),
        }));

        return DataSourceSchema.parse({
          id: `ds_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          name,
          type: 'dataset',
          fields,
          records: parsed,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      } else if (typeof parsed === 'object' && parsed !== null) {
        const fields: DataSourceField[] = Object.keys(parsed).map((key) => ({
          key,
          label: key,
          type: typeof parsed[key] === 'number' ? 'number' : 'string',
          sensitive: key.toLowerCase().includes('secret') || key.toLowerCase().includes('password'),
        }));

        return DataSourceSchema.parse({
          id: `ds_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          name,
          type: 'profile',
          fields,
          records: [parsed],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    } catch (err) {
      throw new Error(`JSON 数据源解析失败: ${(err as Error).message}`);
    }

    throw new Error('无效的 JSON 数据源内容');
  }

  /**
   * 从 CSV / 逗号分隔文本解析生成 DataSource
   */
  public static parseFromCSV(csvStr: string, name: string = 'CSV 数据源'): DataSource {
    const lines = csvStr.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      throw new Error('CSV 数据至少需要包含标题行和一行数据');
    }

    const headers = lines[0].split(',').map((h) => h.trim());
    const records: Record<string, any>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map((v) => v.trim());
      const record: Record<string, any> = {};
      headers.forEach((h, idx) => {
        record[h] = values[idx] ?? '';
      });
      records.push(record);
    }

    const fields: DataSourceField[] = headers.map((key) => ({
      key,
      label: key,
      type: 'string',
      sensitive: false,
    }));

    return DataSourceSchema.parse({
      id: `ds_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name,
      type: 'dataset',
      fields,
      records,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
}
