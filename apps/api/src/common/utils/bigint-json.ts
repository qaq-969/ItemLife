/**
 * 金额列使用 BIGINT，Prisma 返回 BigInt 原生类型；JSON.stringify 默认不支持 BigInt。
 * 统一序列化为 Number：本项目金额上限远小于 2^53 分（≈90 万亿元），无精度风险。
 */
export function patchBigIntJson(): void {
  const proto = BigInt.prototype as unknown as { toJSON?: () => number };
  if (typeof proto.toJSON !== 'function') {
    proto.toJSON = function toJSON(this: bigint): number {
      return Number(this);
    };
  }
}
