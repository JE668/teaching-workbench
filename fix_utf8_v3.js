const fs = require('fs');
const f = '/Users/je/teaching-workbench/server/src/services/teachingData/excel.ts';
let c = fs.readFileSync(f, 'utf8');
// Fix line 43 - the UTF-8''' breaks the single-quoted string
// Replace the entire contentDisposition function
c = c.replace(
    /export function contentDisposition\(stored: StoredFetch\): string \{[\s\S]*?\n\}/,
    "export function contentDisposition(stored: StoredFetch): string {\n  const { pretty, ascii } = exportFilename(stored);\n  return `attachment; filename=\"${ascii}\"; filename*=UTF-8'''${encodeURIComponent(pretty)}`;\n}"
);
fs.writeFileSync(f, c);
console.log('Fixed');