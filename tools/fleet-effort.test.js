'use strict';
// Every agent() call in the fleet script runs at cfg.effort, and cfg.effort defaults to 'high'
// (Dan, 2026-09-28). Scans the real call expressions, skipping comments and prompt text, so a new
// agent() call that forgets its effort fails here instead of running at the harness default.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FLEET_SCRIPT = path.join(__dirname, '..', 'aac-skills', 'ticket-fleet', 'ticket-fleet.js');

function calls(src){const out=[];let i=0,n=src.length;const st=[];
 while(i<n){const c=src[i],d=src[i+1];
  if(c==='/'&&d==='/'){i=src.indexOf('\n',i);if(i<0)break;continue}
  if(c==='/'&&d==='*'){i=src.indexOf('*/',i)+2;continue}
  if(c==="'"||c==='"'){const q=c;i++;while(i<n&&src[i]!==q){if(src[i]==='\\')i++;i++}i++;continue}
  if(c==='`'){i++;let depth=0;while(i<n){if(src[i]==='\\'){i+=2;continue}if(src[i]==='`'&&depth===0)break;if(src[i]==='$'&&src[i+1]==='{'){depth++;i+=2;continue}if(src[i]==='}'&&depth>0){depth--;i++;continue}i++}i++;continue}
  if(/\bagent\($/.test(src.slice(Math.max(0,i-6),i+1))&&!/[\w.]/.test(src[i-6]||'')){
    // find matching paren
    let j=i+1,p=1;while(j<n&&p>0){const ch=src[j];if(ch==='`'){j++;let dep=0;while(j<n){if(src[j]==='\\'){j+=2;continue}if(src[j]==='`'&&dep===0)break;if(src[j]==='$'&&src[j+1]==='{'){dep++;j+=2;continue}if(src[j]==='}'&&dep>0){dep--;j++;continue}j++}j++;continue}if(ch==="'"||ch==='"'){const q=ch;j++;while(j<n&&src[j]!==q){if(src[j]==='\\')j++;j++}j++;continue}if(ch==='(')p++;if(ch===')')p--;j++}
    const body=src.slice(i+1,j-1);const line=src.slice(0,i).split('\n').length;
    const m=body.match(/effort:\s*([^,}\s]+)/g);out.push({line,effort:m?m[m.length-1]:null});i=j;continue}
  i++}
 return out}

test('every agent() call in the fleet script passes effort: cfg.effort', () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  const found = calls(src);
  assert.ok(found.length >= 20, 'the scanner found the agent() calls (' + found.length + ')');
  assert.deepEqual(found.filter(c => c.effort !== 'effort: cfg.effort'), []);
});

test("cfg.effort defaults to 'high' (Dan, 2026-09-28)", () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src, /^\s*effort: 'high',/m);
});
