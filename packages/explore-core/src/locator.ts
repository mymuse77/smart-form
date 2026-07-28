import { ActionTarget } from './trace';

export class LocatorGenerator {
  public static generatePlaywrightLocator(target?: ActionTarget): string {
    if (!target) return `page.locator('body')`;

    if (target.role && target.label) {
      return `page.getByRole('${target.role}', { name: '${target.label}' })`;
    }
    if (target.label) {
      return `page.getByLabel('${target.label}')`;
    }
    if (target.testId) {
      return `page.getByTestId('${target.testId}')`;
    }
    if (target.text) {
      return `page.getByText('${target.text}')`;
    }
    if (target.selector) {
      return `page.locator('${target.selector}')`;
    }

    return `page.locator('body')`;
  }
}
