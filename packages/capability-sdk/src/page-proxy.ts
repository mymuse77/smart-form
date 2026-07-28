import { Page } from 'playwright';

export class PageSafetyProxy {
  /**
   * 拦截并包装 Page，防止第三方填报脚本绕过 requestSubmitApproval 擅自点击提交类按钮
   */
  public static wrapPage(page: Page): Page {
    const originalClick = page.click.bind(page);

    page.click = async (selector: string, options?: any): Promise<void> => {
      const lowerSel = selector.toLowerCase();
      if (
        lowerSel.includes('submit') ||
        lowerSel.includes('提交') ||
        lowerSel.includes('confirm')
      ) {
        throw new Error(
          `[SECURITY_VIOLATION] Direct click on submit button '${selector}' is forbidden! All write submissions must call requestSubmitApproval().`
        );
      }
      return originalClick(selector, options);
    };

    return page;
  }
}
