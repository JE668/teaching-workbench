const fs = require('fs');
const f = '/Users/je/teaching-workbench/server/src/services/teachingData/excel.ts';
let c = fs.readFileSync(f, 'utf8');
// Fix line 43 - the UTF-8''' breaks the single-quoted string
c = c.replace(
    /return 'attachment; filename=\"' \+ ascii \+ '\"'; filename\*=UTF-8''' \+ encodeURIComponent\(pretty\);/,
    "return `attachment; filename=\"${ascii}\"; filename*=UTF-8'''${encodeURIComponent(pretty)}`;"
);
fs.writeFileSync(f, c);
console.log('Fixed');