/**
 * @smart-form/contracts
 * 
 * 全系统共享的核心类型定义。
 * 
 * 所有 apps（web / desktop / server）和 packages 通过引用此包获取
 * 统一的 DTO、事件、消息和接口类型，确保跨端类型一致性。
 * 
 * Browser Use Python Sidecar 使用由此包生成的 JSON Schema，
 * 不直接引用 TypeScript 模块。
 */

export * from './task.js';
export * from './events.js';
export * from './capability.js';
export * from './control.js';
export * from './realtime.js';
