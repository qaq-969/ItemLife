import { v7 as uuidv7 } from 'uuid';

const UUID_HEX_LENGTH = 32;

/** 主键字节串类型：与 Prisma 的 Bytes（Uint8Array<ArrayBuffer>）保持一致 */
export type IdBytes = Uint8Array<ArrayBuffer>;

/**
 * 应用层主键生成：UUID v7（时间有序，索引局部性好），以 BINARY(16) 存储。
 * 说明：MySQL 8 无 UUID v7 原生函数，故统一由应用层生成后写入。
 */
export function newId(): IdBytes {
  return uuidToBytes(uuidv7());
}

/** UUID 字符串 → 16 字节；可直接写入 Prisma 的 Bytes 字段。 */
export function uuidToBytes(uuid: string): IdBytes {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== UUID_HEX_LENGTH || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`不是合法的 UUID：${uuid}`);
  }
  const bytes = new Uint8Array(16) as IdBytes;
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** 16 字节 → 标准 UUID 字符串。 */
export function bytesToUuid(value: Uint8Array): string {
  const hex = Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 把外部传入的 UUID 字符串转换为可查询的字节串；非法输入返回 null 供调用方返回 400。 */
export function toIdBytes(value: string | undefined | null): IdBytes | null {
  if (!value) return null;
  const hex = value.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  return uuidToBytes(hex);
}
