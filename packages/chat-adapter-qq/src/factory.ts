import { ValidationError } from '@chat-adapter/shared';

import type { QQAdapterConfig } from './types.js';

import { QQAdapter } from './adapter.js';

/**
 * 创建 QQ 适配器实例。
 * 仅支持显式配置，不读取环境变量。
 *
 * @param config QQ 适配器配置
 * @returns 已创建但未初始化的 QQAdapter 实例
 */
export function createQQAdapter(config: QQAdapterConfig): QQAdapter {
  if (!config || !config.napcat) {
    throw new ValidationError(
      'qq',
      'QQ NapCat config is required. Pass { napcat: NCWebsocketOptions } to createQQAdapter(config).'
    );
  }

  return new QQAdapter(config);
}
