import { TransformType } from './types';

export class SafeTransformEngine {
  public static applyTransform(value: unknown, transformType?: TransformType): unknown {
    if (value === null || value === undefined) return value;
    const strVal = String(value);

    switch (transformType) {
      case 'trim':
        return strVal.trim();
      case 'uppercase':
        return strVal.toUpperCase();
      case 'lowercase':
        return strVal.toLowerCase();
      case 'date_format_iso':
        try {
          return new Date(strVal).toISOString().split('T')[0];
        } catch {
          return strVal;
        }
      case 'number_to_fixed_2':
        const num = parseFloat(strVal);
        return isNaN(num) ? strVal : num.toFixed(2);
      default:
        return value;
    }
  }
}
