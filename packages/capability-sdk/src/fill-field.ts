import { Page } from 'playwright';

export async function safeFillField(page: Page, selector: string, value: any): Promise<void> {
  const strVal = String(value ?? '');
  const locator = page.locator(selector);

  try {
    const tagName = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
    const typeAttr = await locator.getAttribute('type').catch(() => '');

    // 1. SELECT 下拉选框处理
    if (tagName === 'select') {
      try {
        await locator.selectOption({ label: strVal });
        return;
      } catch {
        await locator.selectOption({ value: strVal });
        return;
      }
    }

    // 2. Checkbox / Radio 选择框处理
    if (typeAttr === 'checkbox' || typeAttr === 'radio') {
      const shouldCheck = Boolean(value) && strVal !== 'false' && strVal !== '0';
      if (shouldCheck) {
        await locator.check();
      } else {
        await locator.uncheck();
      }
      return;
    }

    // 3. 文本框与受控组件 (Native / React / Vue)
    await locator.fill(strVal);
    const actualVal = await locator.inputValue().catch(() => '');
    if (actualVal === strVal) {
      return;
    }
  } catch (err) {
    // 忽略直接 fill 异常，自动走向按键逐字模拟回退
  }

  // Fallback: 逐字模拟按键输入，触发 React / Vue 受控组件 onChange 挂载
  try {
    await locator.focus();
    await locator.clear();
    await locator.pressSequentially(strVal, { delay: 30 });
  } catch {
    // ignore
  }
}

