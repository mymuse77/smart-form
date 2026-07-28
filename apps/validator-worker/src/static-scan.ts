import * as ts from 'typescript';

export interface ScanResult {
  passed: boolean;
  violations: string[];
}

export class StaticSecurityScanner {
  private static FORBIDDEN_KEYWORDS = ['child_process', 'eval', 'Function', 'fs.unlink', 'process.env'];

  public static scanCode(codeContent: string): ScanResult {
    const violations: string[] = [];
    const sourceFile = ts.createSourceFile(
      'script.ts',
      codeContent,
      ts.ScriptTarget.Latest,
      true
    );

    const visit = (node: ts.Node) => {
      // 1. 检查 forbidden 关键字导入或调用
      if (ts.isIdentifier(node)) {
        if (this.FORBIDDEN_KEYWORDS.includes(node.text)) {
          violations.push(`Security violation: forbidden identifier '${node.text}' found at line ${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
      }

      // 2. 检查 CallExpression 是否为 eval()
      if (ts.isCallExpression(node)) {
        const expressionText = node.expression.getText(sourceFile);
        if (expressionText === 'eval' || expressionText === 'Function') {
          violations.push(`Security violation: dangerous dynamic code execution '${expressionText}' detected.`);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return {
      passed: violations.length === 0,
      violations,
    };
  }
}
