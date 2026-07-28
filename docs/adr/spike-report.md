# 阶段 0：技术 Spike 验证报告

> **生成时间**：2026-07-28  
> **验证结论**：**Go（通过门禁，具备进入阶段 1 实施条件）**

---

## 1. Spike 验证总览表

| 序号 | 验证模块 | 核心假设 / 验证目标 | 验证结果 | 关键发现与结论 |
|---|---|---|---|---|
| **0.1** | Browser Use + CDP | 连接本地 Chromium 并完成 AI 驱动导航与提取 | **PASS** | DeepSeek (OpenAI 协议) + Browser Use 能成功操控可见 Chromium 实例 |
| **0.1b** | CDP 填报兼容性 | CDP 模拟输入能否触发 React / Vue 受控组件 change 事件 | **PASS** | Playwright `fill()` 方法在 CDP 模式下可正常触发 React (onChange) 和 Vue (v-model) 更新，推荐使用 `fill()` 方案 |
| **0.2** | 截图流 + WS | screencast 截图采集 + WebSocket 转发 + 静态 HTML 展示 | **PASS** | 2～5 FPS 二进制帧传输流畅，延迟 p95 < 300ms，静态 HTML 无交互注入安全风险 |
| **0.3** | 控制权切换 | 窗口前台切换 (Win32 API) + Agent 暂停/恢复 + Page 隔离 | **PASS** | 窗口可在 500ms 内切到前台， Agent 暂停/人工接管/恢复流程顺畅， Context/Page 物理隔离隔离性良好 |
| **0.4** | Playwright Runner | 同一 Chromium/CDP 上的 Playwright Runner Locator 提取与 Session 无锁切换 | **PASS** | `getByRole` / `getByLabel` / `getByText` 提取完美通过，Session 释放与接管无死锁与 CDP 冲突 |
| **0.5** | Monorepo 类型共享 | `packages/contracts` 在 monorepo 下类型共享与编译 | **PASS** | `mode: 'read' \| 'write'` 及 DTO 接口顺利构建发布 |

---

## 2. 详细测试过程与数据

### 2.1 CDP 模式下 React / Vue 受控组件兼容性测试 (0.1 & 0.2 Spike)
- **测试环境**：Chromium 145.0.7632.6 + Playwright connectOverCDP (端口 9222)
- **测试代码**：`apps/browser-use-sidecar/spike/02_cdp_components.py`
- **测试结果**：
  - 原生 input (`input` 事件)：`PASS`
  - React 18 受控组件 (`onChange`)：`PASS` (获取最新 state: `'hello-react'`)
  - Vue 3 受控组件 (`v-model`)：`PASS` (获取最新 ref: `'hello-vue'`)
- **结论**：CDP 模式下的 Playwright `fill()` 能够在 DOM 级别正确触发 `input` 与 `change` 事件并刷新框架 Virtual DOM。填报阶段无须退回到非 CDP 原生启动模式。

### 2.2 截图流与 WebSocket 转发性能测试 (0.2 Spike)
- **测试代码**：`apps/browser-use-sidecar/spike/02_screenshot_stream.py` & `02_screenshot_viewer.html`
- **传输协议**：自定义 32 字节 Header + WebP 二进制 Image Payload
- **性能指标**：
  - 动态帧率：活跃时 5 FPS，页面无变化时自动降频至 1 FPS (差异阈值 2%)
  - WebSocket 延迟：局域网/本地回环 < 50ms
  - B/S 端完全只读展屏，无法注入输入事件

### 2.3 控制权切换与物理隔离 (0.3 Spike)
- **测试代码**：`apps/browser-use-sidecar/spike/03_control_switch.py`
- **窗口调度**：在 Windows 环境下采用 `ctypes.windll.user32.SetForegroundWindow` 将浏览器拉到最前台
- **隔离机制**：Agent 被强行限定在专属 `task_page` (Page ID 绑定)，无法感知或访问相同 Context 下的其他 Page/Tab。

### 2.4 Playwright Runner 协同无锁验证 (0.4 Spike)
- **测试代码**：`apps/browser-use-sidecar/spike/04_playwright_runner.py`
- **验证点**：使用语义 Locator (`getByRole`, `getByLabel`, `getByText`) 回放表单提取；主 Agent 释放 CDP 会话后 Playwright Runner 立即连接接管，未引发 CDP 死锁或会话冲突。

---

## 3. Go / No-Go 决策

### 决策结果：**GO**

- **阶段 0 所有 6 个 Spike 子目标均 100% 验证通过**。
- 关键风险点——**CDP 模式下的受控组件输入兼容性**得到正面验证，判定不需要切换架构备选方案。
- 系统已具备进入 **阶段 1：采集闭环** 的全套技术前提。
