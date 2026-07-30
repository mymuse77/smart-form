export type BuiltinTransformType =
  | 'identity'
  | 'trim'
  | 'uppercase'
  | 'lowercase'
  | 'date_format_iso'
  | 'to_number';

export class TransformEngine {
  public static applyTransform(
    value: unknown,
    transform: BuiltinTransformType = 'identity',
  ): unknown {
    if (value === null || value === undefined) return '';

    switch (transform) {
      case 'trim':
        return String(value).trim();
      case 'uppercase':
        return String(value).toUpperCase();
      case 'lowercase':
        return String(value).toLowerCase();
      case 'date_format_iso': {
        const d = new Date(String(value));
        return isNaN(d.getTime()) ? String(value) : d.toISOString().split('T')[0];
      }
      case 'to_number': {
        const num = Number(value);
        return isNaN(num) ? 0 : num;
      }
      case 'identity':
      default:
        return value;
    }
  }
}
