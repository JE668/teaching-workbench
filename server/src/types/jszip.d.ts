// jszip 未附带 TS 类型；提供最小环境声明供测试解包校验 docx。
declare module 'jszip' {
  const JSZip: any;
  export = JSZip;
}
