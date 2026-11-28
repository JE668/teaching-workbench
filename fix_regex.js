const fs = require('fs');
const content = fs.readFileSync('/Users/je/teaching-workbench/server/src/services/teachingData/excel.ts', 'utf8');
// The regex currently has literal \r\n in it, need to fix to \\r\\n
const fixed = content.replace(
    /return value\.replace\([\s\S]*?\);/,
    "return value.replace(/[\\\\/:*?\\\\\"<>|\\r\\n\\u0000]/g, '_').trim() || '未命名';"
);
fs.writeFileSync('/Users/je/teaching-workbench/server/src/services/teachingData/excel.ts', fixed);
console.log('Fixed');