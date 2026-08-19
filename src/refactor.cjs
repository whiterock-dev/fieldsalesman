const fs = require('fs');

function refactorFile(path) {
  let content = fs.readFileSync(path, 'utf8');

  // Customer type
  content = content.replace(/landmark:\s*string/g, 'area: string\n  state: string');
  
  // quickLead type
  content = content.replace(/landmark:\s*string/g, 'area: string\n    state: string'); // might replace again, let's be more specific below

  // Instead of global replace, let's just write specific replacements for App.tsx
  fs.writeFileSync(path, content, 'utf8');
}
