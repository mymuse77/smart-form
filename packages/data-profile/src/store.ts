import { DataSource } from './types';

export class DataSourceStore {
  private static store: Map<string, DataSource> = new Map();

  static {
    // 默认内置的常用填报测试数据源
    const defaultProcurementProfile: DataSource = {
      id: 'ds_default_procurement',
      name: '标准采购申报 Profile',
      type: 'profile',
      fields: [
        { key: 'applicant', label: '申请人姓名', type: 'string', sensitive: false },
        { key: 'projectName', label: '项目名称', type: 'string', sensitive: false },
        { key: 'category', label: '采购类别', type: 'string', sensitive: false },
        { key: 'budget', label: '预算金额', type: 'number', sensitive: false },
      ],
      records: [
        {
          applicant: '张伟 (采购部)',
          projectName: '智能办公高配终端采购计划',
          category: 'hardware',
          budget: 85000,
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.store.set(defaultProcurementProfile.id, defaultProcurementProfile);
  }

  public static get(id: string): DataSource | undefined {
    return this.store.get(id);
  }

  public static getDefaultProfile(): DataSource | undefined {
    return this.store.get('ds_default_procurement');
  }

  public static list(): DataSource[] {
    return Array.from(this.store.values());
  }

  public static save(ds: DataSource): void {
    this.store.set(ds.id, ds);
  }

  public static delete(id: string): boolean {
    return this.store.delete(id);
  }
}
