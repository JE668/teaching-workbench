// pizzip 无根级类型字段，NodeNext 下补最小声明供 import PizZip 使用。
declare module 'pizzip' {
  interface PizFile {
    asText(): string;
    asUint8Array(): Uint8Array;
  }
  class PizZip {
    load(data: Buffer | Uint8Array | string): Promise<PizZip>;
    loadFile(path: string): Promise<PizZip>;
    generate(opts?: { type?: string; [k: string]: unknown }): Promise<Buffer>;
    /** 读取某文件 */
    file(name: string): PizFile;
    /** 新增/覆盖某文件 */
    file(name: string, data: string | Uint8Array, options?: unknown): PizZip;
  }
  export = PizZip;
}
