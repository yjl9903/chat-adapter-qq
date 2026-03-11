import { LRUCache } from 'lru-cache';
import {
  type NCWebsocketOptions,
  type WSSendParam,
  type WSSendReturn,
  NCWebsocket
} from 'node-napcat-ts';

type AsyncFn<TArgs extends any[], TResult> = (...args: TArgs) => Promise<TResult>;

type AnyPromise = Promise<unknown>;

interface MemoizeAsyncOptions<TArgs extends any[], TResult> {
  key: (...args: TArgs) => string;

  ttl: number;

  fn: AsyncFn<TArgs, TResult>;
}

export interface MemoizedAsyncFn<TArgs extends any[], TResult> extends AsyncFn<TArgs, TResult> {
  keyOf(...args: TArgs): string;

  invalidate(...args: TArgs): void;
}

/**
 * 创建异步缓存高阶函数工厂：
 * - 使用 LRUCache 保存值
 * - 同 key 并发请求复用同一个 in-flight Promise
 */
export function createAsyncMemoFactory(
  cache: LRUCache<string, any>,
  inFlight: Map<string, AnyPromise> = new Map()
) {
  return function memoizeAsync<TArgs extends any[], TResult>({
    key,
    ttl,
    fn
  }: MemoizeAsyncOptions<TArgs, TResult>): MemoizedAsyncFn<TArgs, TResult> {
    const invalidateKey = (cacheKey: string): void => {
      cache.delete(cacheKey);
      inFlight.delete(cacheKey);
    };

    const memoized = async (...args: TArgs): Promise<TResult> => {
      const cacheKey = key(...args);
      const hit = cache.get(cacheKey);
      if (hit !== undefined) {
        return hit as TResult;
      }

      const pending = inFlight.get(cacheKey);
      if (pending) {
        return pending as Promise<TResult>;
      }

      const request = fn(...args)
        .then((result) => {
          cache.set(cacheKey, result as unknown, { ttl });
          return result;
        })
        .finally(() => {
          inFlight.delete(cacheKey);
        });

      inFlight.set(cacheKey, request as AnyPromise);
      return request;
    };

    memoized.keyOf = (...args: TArgs): string => key(...args);
    memoized.invalidate = (...args: TArgs): void => {
      invalidateKey(key(...args));
    };

    return memoized;
  };
}

type CacheMethodName =
  | 'get_login_info'
  | 'get_friend_list'
  | 'get_stranger_info'
  | 'get_group_info'
  | 'get_group_member_info'
  | 'get_group_member_list';

const DEFAULT_TTL_MS: Record<CacheMethodName, number> = {
  get_login_info: 5 * 60 * 1000,
  get_friend_list: 60 * 1000,
  get_stranger_info: 30 * 1000,
  get_group_info: 30 * 1000,
  get_group_member_info: 15 * 1000,
  get_group_member_list: 15 * 1000
};

export interface CachedNCWebsocketOptions {
  max?: number;

  ttl?: Partial<Record<CacheMethodName, number>>;
}

/**
 * 带内存缓存的 NapCat WebSocket 客户端。
 */
export class CachedNCWebsocket extends NCWebsocket {
  private readonly cache: LRUCache<string, any>;

  private readonly inFlight = new Map<string, Promise<unknown>>();

  private readonly ttl: Record<CacheMethodName, number>;

  public override get_login_info!: MemoizedAsyncFn<[], WSSendReturn['get_login_info']>;

  public override get_friend_list!: MemoizedAsyncFn<[], WSSendReturn['get_friend_list']>;

  public override get_stranger_info!: MemoizedAsyncFn<
    [WSSendParam['get_stranger_info']],
    WSSendReturn['get_stranger_info']
  >;

  public override get_group_info!: MemoizedAsyncFn<
    [WSSendParam['get_group_info']],
    WSSendReturn['get_group_info']
  >;

  public override get_group_member_info!: MemoizedAsyncFn<
    [WSSendParam['get_group_member_info']],
    WSSendReturn['get_group_member_info']
  >;

  public override get_group_member_list!: MemoizedAsyncFn<
    [WSSendParam['get_group_member_list']],
    WSSendReturn['get_group_member_list']
  >;

  public constructor(
    options: NCWebsocketOptions,
    debug = false,
    cacheOptions?: CachedNCWebsocketOptions
  ) {
    super(options, debug);

    this.ttl = {
      ...DEFAULT_TTL_MS,
      ...(cacheOptions?.ttl ?? {})
    };

    this.cache = new LRUCache<string, any>({
      max: cacheOptions?.max ?? 1000
    });

    const memoizeAsync = createAsyncMemoFactory(this.cache, this.inFlight);

    this.get_login_info = memoizeAsync({
      key: () => 'get_login_info',
      ttl: this.ttl.get_login_info,
      fn: () => super.get_login_info()
    });

    this.get_friend_list = memoizeAsync({
      key: () => 'get_friend_list',
      ttl: this.ttl.get_friend_list,
      fn: () => super.get_friend_list()
    });

    this.get_stranger_info = memoizeAsync({
      key: (params) => `get_stranger_info:${params.user_id}`,
      ttl: this.ttl.get_stranger_info,
      fn: (params) => super.get_stranger_info(params)
    });

    this.get_group_info = memoizeAsync({
      key: (params) => `get_group_info:${params.group_id}`,
      ttl: this.ttl.get_group_info,
      fn: (params) => super.get_group_info(params)
    });

    this.get_group_member_info = memoizeAsync({
      key: (params) => `get_group_member_info:${params.group_id}:${params.user_id}`,
      ttl: this.ttl.get_group_member_info,
      fn: (params) => super.get_group_member_info(params)
    });

    this.get_group_member_list = memoizeAsync({
      key: (params) => `get_group_member_list:${params.group_id}`,
      ttl: this.ttl.get_group_member_list,
      fn: (params) => super.get_group_member_list(params)
    });
  }

  public override async set_friend_remark(params: WSSendParam['set_friend_remark']): Promise<null> {
    const result = await super.set_friend_remark(params);
    this.get_friend_list.invalidate();
    this.get_stranger_info.invalidate({ user_id: params.user_id });
    return result;
  }

  public override async set_group_card(params: WSSendParam['set_group_card']): Promise<null> {
    const result = await super.set_group_card(params);
    this.get_group_member_info.invalidate({
      group_id: params.group_id,
      user_id: params.user_id
    });
    this.get_group_member_list.invalidate({ group_id: params.group_id });
    return result;
  }

  public override async set_group_name(params: WSSendParam['set_group_name']): Promise<null> {
    const result = await super.set_group_name(params);
    this.get_group_info.invalidate({ group_id: params.group_id });
    return result;
  }

  public override async set_group_leave(params: WSSendParam['set_group_leave']): Promise<null> {
    const result = await super.set_group_leave(params);
    this.get_group_info.invalidate({ group_id: params.group_id });
    this.get_group_member_list.invalidate({ group_id: params.group_id });
    this.invalidate(`get_group_member_info:${params.group_id}:`);
    return result;
  }

  public override async set_group_kick(params: WSSendParam['set_group_kick']): Promise<null> {
    const result = await super.set_group_kick(params);
    this.get_group_member_info.invalidate({
      group_id: params.group_id,
      user_id: params.user_id
    });
    this.get_group_member_list.invalidate({ group_id: params.group_id });
    return result;
  }

  /**
   * 按前缀清空缓存
   */
  public invalidate(prefix: string = ''): void {
    for (const cacheKey of this.cache.keys()) {
      if (cacheKey.startsWith(prefix)) {
        this.cache.delete(cacheKey);
      }
    }
    for (const cacheKey of this.inFlight.keys()) {
      if (cacheKey.startsWith(prefix)) {
        this.inFlight.delete(cacheKey);
      }
    }
  }
}
