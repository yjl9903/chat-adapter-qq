import type { Logger } from 'chat';

import type {
  QQAdapterHeartbeatFailureEvent,
  QQAdapterHeartbeatReconnectedEvent,
  QQAdapterHeartbeatReconnectingEvent,
  QQHeartbeatConfig,
  QQNapcatStatus
} from '../types.js';

/** 心跳轮询默认间隔（30s）。 */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

/** 心跳连续失败默认阈值（达到后触发重连）。 */
const DEFAULT_HEARTBEAT_FAILURE_THRESHOLD = 2;

export interface QQNapcatConnectionHeartbeatOptions extends QQHeartbeatConfig {
  logger: Logger;

  /** 拉取 NapCat 当前运行状态。 */
  getStatus: () => Promise<QQNapcatStatus>;

  /** 心跳不健康时的恢复动作（通常为重连 + 刷新登录态）。 */
  reconnect: () => Promise<void>;

  /** 心跳失败时上报给上层适配器。 */
  onFailure?: (event: QQAdapterHeartbeatFailureEvent) => void | Promise<void>;

  /** 心跳触发恢复前上报给上层适配器。 */
  onReconnecting?: (event: QQAdapterHeartbeatReconnectingEvent) => void | Promise<void>;

  /** 心跳触发恢复成功后上报给上层适配器。 */
  onReconnected?: (event: QQAdapterHeartbeatReconnectedEvent) => void | Promise<void>;
}

/**
 * 管理 NapCat 连接心跳：
 * - 定时轮询 get_status
 * - 失败/不健康累计后触发恢复
 * - 保证同一时刻只执行一个心跳请求
 */
export class QQNapcatConnectionHeartbeat {
  private readonly logger: Logger;

  private readonly getStatus: () => Promise<QQNapcatStatus>;

  private readonly reconnect: () => Promise<void>;

  private readonly onFailureEvent?: (event: QQAdapterHeartbeatFailureEvent) => void | Promise<void>;

  private readonly onReconnecting?: (
    event: QQAdapterHeartbeatReconnectingEvent
  ) => void | Promise<void>;

  private readonly onReconnected?: (
    event: QQAdapterHeartbeatReconnectedEvent
  ) => void | Promise<void>;

  private readonly intervalMs: number;

  private readonly failureThreshold: number;

  private readonly reconnectOnFailure: boolean;

  private timer?: ReturnType<typeof setInterval>;

  private inFlight?: Promise<void>;

  private failures = 0;

  private recovering = false;

  private running = false;

  public constructor(options: QQNapcatConnectionHeartbeatOptions) {
    this.logger = options.logger;
    this.getStatus = options.getStatus;
    this.reconnect = options.reconnect;
    this.onFailureEvent = options.onFailure;
    this.onReconnecting = options.onReconnecting;
    this.onReconnected = options.onReconnected;
    this.intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.failureThreshold = options.failureThreshold ?? DEFAULT_HEARTBEAT_FAILURE_THRESHOLD;
    this.reconnectOnFailure = options.reconnectOnFailure ?? true;
  }

  /** 启动状态轮询。 */
  public start(): void {
    if (this.timer) {
      return;
    }

    this.running = true;
    this.failures = 0;
    this.recovering = false;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  /** 停止轮询并重置心跳状态。 */
  public stop(): void {
    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    this.inFlight = undefined;
    this.failures = 0;
    this.recovering = false;
  }

  private runOnce(): Promise<void> {
    if (!this.running) {
      return Promise.resolve();
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    const heartbeatTask = this.checkStatus()
      .catch((error) => {
        this.logger.warn('qq heartbeat check failed', error);
      })
      .finally(() => {
        if (this.inFlight === heartbeatTask) {
          this.inFlight = undefined;
        }
      });

    this.inFlight = heartbeatTask;
    return heartbeatTask;
  }

  private async checkStatus(): Promise<void> {
    if (!this.running) {
      return;
    }

    let status: QQNapcatStatus;
    try {
      status = await this.getStatus();
    } catch (error) {
      this.logger.warn('qq heartbeat status request failed', error);
      await this.onFailure({ error });
      return;
    }

    if (!this.running) {
      return;
    }

    const healthy = status.online && status.good;
    if (healthy) {
      this.failures = 0;
      return;
    }

    this.logger.warn('qq heartbeat unhealthy status', status);
    await this.onFailure({ status });
  }

  private async onFailure({
    status,
    error
  }: {
    status?: QQNapcatStatus;
    error?: unknown;
  }): Promise<void> {
    if (!this.running) {
      return;
    }

    this.failures += 1;
    const willReconnect =
      this.reconnectOnFailure && this.failures >= this.failureThreshold && !this.recovering;

    await this.onFailureEvent?.({
      type: 'heartbeat.failure',
      failures: this.failures,
      threshold: this.failureThreshold,
      status,
      error,
      willReconnect
    });

    if (!this.running) {
      return;
    }

    if (!this.reconnectOnFailure) {
      return;
    }

    if (this.failures < this.failureThreshold || this.recovering) {
      return;
    }

    this.recovering = true;

    try {
      this.logger.warn('qq heartbeat reconnecting', {
        failures: this.failures,
        online: status?.online,
        good: status?.good
      });
      await this.onReconnecting?.({
        type: 'heartbeat.reconnecting',
        failures: this.failures,
        threshold: this.failureThreshold,
        trigger: 'heartbeat',
        status
      });
      if (!this.running) {
        return;
      }
      await this.reconnect();
      if (this.running) {
        await this.onReconnected?.({
          type: 'heartbeat.reconnected',
          failures: this.failures,
          threshold: this.failureThreshold,
          trigger: 'heartbeat',
          status
        });
        this.failures = 0;
      }
    } catch (error) {
      this.logger.error('qq heartbeat reconnect failed', error);
    } finally {
      this.recovering = false;
    }
  }
}
