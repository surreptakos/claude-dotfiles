/*
 * build_sop.js - AAC SOP generator
 * Usage:  node build_sop.js <input.json> <output.docx>
 * Reads a single SOP described in JSON and writes a styled Word document
 * in AAC's house format. Requires the `docx` npm package (npm install docx).
 *
 * See references/example_input.json for a complete input example and the
 * schema in references/input-schema.md. Optional sections (exceptions,
 * troubleshooting, metrics, references) are omitted automatically when empty.
 */
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        Header, Footer, AlignmentType, LevelFormat, HeadingLevel, BorderStyle,
        WidthType, ShadingType, PageNumber, TabStopType, UnderlineType } = require('docx');

const NAVY = "1F3864", BLUE = "2E75B6", LIGHT = "D5E8F0", GREY = "808080",
      LINE = "CCCCCC", RED = "C00000";
const border = { style: BorderStyle.SINGLE, size: 1, color: LINE };
const borders = { top: border, bottom: border, left: border, right: border };
const cmar = { top: 80, bottom: 80, left: 120, right: 120 };

// ---- module-level helpers/constants ----
const arr = v => Array.isArray(v) ? v : [];
const str = v => (v === undefined || v === null) ? "" : String(v);
const CW=10800; const sc=n=>Math.round(n*CW/9360); const BAND="DCE6F1";

// ---- helpers ----
function h1(t){return new Paragraph({heading:HeadingLevel.HEADING_1,children:[new TextRun(t)]});}
function p(t,o={}){return new Paragraph({pageBreakBefore:!!o.pageBreakBefore,indent:o.indent,spacing:{after:o.after===undefined?120:o.after,before:o.before||0},
  children:[new TextRun({text:t,italics:!!o.italics,bold:!!o.bold,color:o.color,size:o.size})]});}
function runsP(children,o={}){return new Paragraph({spacing:{after:o.after===undefined?120:o.after,before:o.before||0},children});}
function lbl(t,o={}){return p(t,{bold:true,before:o.before===undefined?340:o.before,after:40,color:o.color,pageBreakBefore:o.pageBreakBefore});}
function labelWithFlag(label,flag){
  const kids=[new TextRun({text:label,bold:true})];
  if(flag) kids.push(new TextRun({text:"  ("+flag+")",italics:true,color:RED,size:22}));
  return runsP(kids,{before:150,after:40});
}
function bullet(t,ind){return new Paragraph({numbering:{reference:"bul",level:0},indent:ind,spacing:{after:80},children:[new TextRun(t)]});}
function step(t){return new Paragraph({numbering:{reference:"stp",level:0},spacing:{after:80},children:[new TextRun(t)]});}
function ifthen(cond,then){return new Paragraph({numbering:{reference:"bul2",level:0},spacing:{after:80},children:[
  new TextRun({text:"IF ",bold:true}),new TextRun(str(cond)),
  new TextRun({text:" \u2192 THEN ",bold:true}),new TextRun(str(then))]});}
function rule(){return new Paragraph({spacing:{after:120,before:0},
  border:{bottom:{style:BorderStyle.SINGLE,size:6,color:BLUE,space:1}},children:[new TextRun("")]});}
function cell(t,o={}){const r=Array.isArray(t)?t:[new TextRun({text:str(t),bold:!!o.bold,color:o.color,italics:!!o.italics})];
  return new TableCell({borders,width:{size:o.w,type:WidthType.DXA},margins:cmar,columnSpan:o.span,
    shading:o.fill?{fill:o.fill,type:ShadingType.CLEAR}:undefined,
    children:[new Paragraph({children:r,spacing:{after:0}})]});}
function headerRow(cells){return new TableRow({tableHeader:true,children:cells});}

function headerBlock(m){
  const a=sc(1900),b=sc(2780),c=sc(1900),e=sc(2780),W=a+b+c+e;
  const row=(l1,v1,l2,v2)=>new TableRow({children:[
    cell(l1,{w:a,fill:LIGHT,bold:true}),cell(v1,{w:b}),
    cell(l2,{w:c,fill:LIGHT,bold:true}),cell(v2,{w:e})]});
  const titleRow=new TableRow({children:[cell("Title",{w:a,fill:LIGHT,bold:true}),cell(m.title,{w:b+c+e,span:3})]});
  return new Table({width:{size:W,type:WidthType.DXA},columnWidths:[a,b,c,e],rows:[
    titleRow,
    row("Department",m.department,"Version",m.version),
    row("Effective Date",m.effective_date,"Next Review",m.next_review),
    row("Prepared by",m.prepared_by,"Approved by",m.approved_by)]});
}
function wiHeaderBlock(m){
  const a=sc(1900),b=sc(2780),c=sc(1900),e=sc(2780),W=a+b+c+e;
  const row=(l1,v1,l2,v2)=>new TableRow({children:[cell(l1,{w:a,fill:LIGHT,bold:true}),cell(v1,{w:b}),cell(l2,{w:c,fill:LIGHT,bold:true}),cell(v2,{w:e})]});
  const rows=[
    new TableRow({children:[cell("Title",{w:a,fill:LIGHT,bold:true}),cell(m.title,{w:b+c+e,span:3})]}),
    row("Department",m.department,"Version",m.version),
    row("Owner",m.owner,"Last updated",m.last_updated)];
  if(m.approved_by) rows.push(row("Approved by",m.approved_by,"",""));
  return new Table({width:{size:W,type:WidthType.DXA},columnWidths:[a,b,c,e],rows});
}
function checkbox(t){return new Paragraph({spacing:{after:60},indent:{left:420,hanging:260},
  children:[new TextRun({text:"\u2610  "}),new TextRun(str(t))]});}
function twoCol(h1c,h2c,rows,w1,w2){ w1=sc(w1);w2=sc(w2);
  const head=headerRow([cell(h1c,{w:w1,fill:NAVY,color:"FFFFFF",bold:true}),cell(h2c,{w:w2,fill:NAVY,color:"FFFFFF",bold:true})]);
  const body=rows.map((r,ri)=>{const f=ri%2===1?BAND:undefined;return new TableRow({children:[cell(r[0],{w:w1,fill:f}),cell(r[1],{w:w2,fill:f})]});});
  return new Table({width:{size:w1+w2,type:WidthType.DXA},columnWidths:[w1,w2],rows:[head,...body]});
}
function threeCol(heads,rows,w){ w=w.map(sc);
  const head=headerRow(heads.map((t,i)=>cell(t,{w:w[i],fill:NAVY,color:"FFFFFF",bold:true})));
  const body=rows.map((r,ri)=>new TableRow({children:r.map((c,i)=>cell(c,{w:w[i],fill:ri%2===1?BAND:undefined}))}));
  return new Table({width:{size:w.reduce((x,y)=>x+y,0),type:WidthType.DXA},columnWidths:w,rows:[head,...body]});
}
function h2(t,o={}){return new Paragraph({heading:HeadingLevel.HEADING_2,pageBreakBefore:!!o.pageBreakBefore,children:[new TextRun(t)]});}
function h3(t,o={}){return new Paragraph({heading:HeadingLevel.HEADING_3,indent:o.indent,children:[new TextRun({text:t,color:o.color})]});}
function quickRefTable(qr){
  const w=[sc(700),sc(2400),sc(6260)];
  const head=headerRow([cell("#",{w:w[0],fill:NAVY,color:"FFFFFF",bold:true}),cell("Step",{w:w[1],fill:NAVY,color:"FFFFFF",bold:true}),cell("What you do",{w:w[2],fill:NAVY,color:"FFFFFF",bold:true})]);
  const body=qr.map((r,ri)=>{ const f=ri%2===1?BAND:undefined;
    const acts=arr(r.actions).map((a,i)=>new Paragraph({spacing:{after:20},children:[new TextRun((i+1)+". "+str(a))]}));
    return new TableRow({cantSplit:true,children:[ cell(str(r.n),{w:w[0],fill:f,bold:true}), cell(str(r.step),{w:w[1],fill:f,bold:true}),
      new TableCell({borders,width:{size:w[2],type:WidthType.DXA},margins:cmar,shading:f?{fill:f,type:ShadingType.CLEAR}:undefined,children:acts.length?acts:[new Paragraph({children:[new TextRun("")]})]})]});});
  return new Table({width:{size:w.reduce((x,y)=>x+y,0),type:WidthType.DXA},columnWidths:w,rows:[head,...body]});
}
function nstep(t,ref){return new Paragraph({numbering:{reference:ref||"stp",level:0},spacing:{after:80},children:[new TextRun(t)]});}
function bulletKV(label,t){return new Paragraph({numbering:{reference:"bul",level:0},spacing:{after:80},children:[new TextRun({text:str(label),bold:true}),new TextRun(str(t))]});}
function genTable(headers,rows,widths){
  const w=((widths&&widths.length===headers.length)?widths:headers.map(()=>Math.floor(9360/Math.max(1,headers.length)))).map(sc);
  const head=headerRow(headers.map((t,i)=>cell(t,{w:w[i],fill:NAVY,color:"FFFFFF",bold:true})));
  const body=rows.map((r,ri)=>new TableRow({cantSplit:true,children:r.map((c,i)=>cell(c,{w:w[i],fill:ri%2===1?BAND:undefined}))}));
  return new Table({width:{size:w.reduce((x,y)=>x+y,0),type:WidthType.DXA},columnWidths:w,rows:[head,...body]});
}
function monoBlock(lines){
  const kids=lines.map(l=>new Paragraph({spacing:{after:0},children:[new TextRun({text:(str(l)||" "),font:"Consolas",size:22})]}));
  const c=new TableCell({borders,width:{size:CW,type:WidthType.DXA},margins:{top:140,bottom:140,left:180,right:180},
    shading:{fill:"F2F2F2",type:ShadingType.CLEAR},children:kids});
  return new Table({width:{size:CW,type:WidthType.DXA},columnWidths:[CW],rows:[new TableRow({children:[c]})]});
}
function swatchCell(label,hex,w){return new TableCell({borders,width:{size:w,type:WidthType.DXA},margins:cmar,
  shading:{fill:hex,type:ShadingType.CLEAR},verticalAlign:"center",
  children:[new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:0},children:[new TextRun({text:str(label),bold:true,color:"FFFFFF",size:22})]})]});}
function swatchTable(headers,rows,widths){
  const w=((widths&&widths.length===headers.length)?widths:headers.map((x,i)=>i===0?1700:Math.floor((9360-1700)/Math.max(1,headers.length-1)))).map(sc);
  const head=headerRow(headers.map((t,i)=>cell(t,{w:w[i],fill:NAVY,color:"FFFFFF",bold:true})));
  const body=rows.map((r,ri)=>{
    const f=ri%2===1?BAND:undefined;
    const first=r.hex?swatchCell(r.label,r.hex,w[0]):cell(r.label,{w:w[0],bold:true,color:NAVY,fill:f});
    const rest=arr(r.cells).map((c,i)=>cell(c,{w:w[i+1],fill:f}));
    return new TableRow({cantSplit:true,children:[first,...rest]});
  });
  return new Table({width:{size:w.reduce((x,y)=>x+y,0),type:WidthType.DXA},columnWidths:w,rows:[head,...body]});
}
function renderBody(items,ind){
  const IND=ind?{left:ind}:undefined;
  const out=[]; let phaseIdx=0, curRef="stp";
  for(const it of arr(items)){
    const k=it.kind;
    if(k==="phase"){ phaseIdx++; curRef=(phaseIdx<=12)?("n"+phaseIdx):"stp"; out.push(h3(str(it.text),{color:NAVY,indent:IND})); }
    else if(k==="step"){ out.push(nstep(str(it.text),curRef)); }
    else if(k==="ifthen"){ out.push(ifthen(it.if,it.then)); }
    else if(k==="note"){ out.push(p(str(it.text),{italics:true,color:GREY,indent:IND})); }
    else if(k==="flag"){ out.push(p(str(it.text),{italics:true,color:RED,indent:IND})); }
    else if(k==="text"){ out.push(p(str(it.text),{indent:IND})); }
    else if(k==="kv"){ out.push(new Paragraph({indent:{left:600+(ind||0)},spacing:{after:120},children:[new TextRun({text:str(it.label),bold:true}),new TextRun(str(it.text))]})); }
    else if(k==="subhead"){ out.push(h3(str(it.text),{indent:IND})); }
    else if(k==="table"){ if(it.title) out.push(p(str(it.title),{bold:true,before:280,after:60,indent:IND})); out.push(genTable(arr(it.headers),arr(it.rows),it.widths)); }
    else if(k==="block"){ if(it.title) out.push(p(str(it.title),{bold:true,before:280,after:60,indent:IND})); out.push(monoBlock(arr(it.lines))); }
    else if(k==="swatch_table"){ if(it.title) out.push(p(str(it.title),{bold:true,before:280,after:60,indent:IND})); out.push(swatchTable(arr(it.headers),arr(it.rows),it.widths)); }
    else if(k==="bullet"){ out.push(it.label?bulletKV(it.label,it.text):bullet(str(it.text))); }
    else { out.push(bullet(str(it.text))); }
  }
  return out;
}

// ---- assemble ----
function buildChildren(d){
const mode=(str(d.mode)||"procedure").toLowerCase();
const ch=[];
ch.push(h1(str(d.title) || (mode==="work_instruction" ? "Work Instruction" : "Standard Operating Procedure")));
ch.push(rule());
if(mode==="work_instruction"){
  ch.push(wiHeaderBlock(d));
  if(d.intro) ch.push(p(str(d.intro),{italics:true,color:GREY,before:120}));
  if(d.banner) ch.push(p(str(d.banner),{italics:true,color:RED,before:120}));
  if(arr(d.quick_reference).length){
    ch.push(h2("Quick reference"));
    ch.push(quickRefTable(arr(d.quick_reference)));
  }
  if(arr(d.responsibilities).length){
    ch.push(h2("Roles & responsibilities"));
    ch.push(twoCol("Role","Responsibility",arr(d.responsibilities).map(r=>[r.role,r.responsibility]),2700,6660));
  }
  if(arr(d.tools).length || str(d.tools)){
    ch.push(h2("Before you start"));
    if(Array.isArray(d.tools)){ for(const t of d.tools){ if(t&&typeof t==="object"&&t.items){ ch.push(h3(str(t.label),{indent:{left:300}})); for(const x of arr(t.items)) ch.push(bullet(str(x),{left:760,hanging:280})); } else ch.push(bullet(str(t))); } }
    else ch.push(p(str(d.tools)));
  }
  ch.push(h2("Steps"));
  for(const node of renderBody(d.steps,300)) ch.push(node);
  ch.push(h2("Done when"));
  ch.push(p(str(d.done_when)));
  if(arr(d.watch_out).length){
    ch.push(h2("Watch out for"));
    for(const w of d.watch_out) ch.push(bullet(str(w)));
  }
  for(const sec of arr(d.sections)){
    ch.push(h2(str(sec.heading)));
    for(const node of renderBody(sec.items)) ch.push(node);
  }
  if(arr(d.checklist).length){
    ch.push(h2(d.checklist_title ? ("Appendix A - "+str(d.checklist_title)) : "Appendix A - Checklist",{pageBreakBefore:true}));
    ch.push(p("Complete Appendix A and Appendix C in the Zoho deal record using the System Surveyor Handoff checklist template; until that template is built, paste both into a Zoho note titled “System Surveyor Handoff Record.” Note in System Surveyor that the completed handoff record is stored in Zoho. These are the conditions that must be true to hand off, not a restatement of the steps.",{italics:true,color:GREY,after:80}));
    for(const c of d.checklist) ch.push(checkbox(c));
  }
  // Quick reference is rendered up front (BLUF), not as an appendix.
  for(const ap of arr(d.appendices)){
    ch.push(h2(str(ap.label),{pageBreakBefore:true}));
    if(ap.intro) ch.push(p(str(ap.intro),{italics:true,color:GREY,after:80}));
    for(const node of renderBody(ap.items)) ch.push(node);
  }
  if(arr(d.records).length){
    ch.push(h2("Records created / storage location",{pageBreakBefore:true}));
    for(const r of arr(d.records)) ch.push(bullet(str(r)));
  }
}
else {
ch.push(headerBlock(d));

if(d.banner) ch.push(p(str(d.banner),{italics:true,color:RED,before:120}));

ch.push(lbl("Objective"));
ch.push(p(str(d.objective)));
ch.push(lbl("Scope"));
ch.push(p(str(d.scope)));

ch.push(lbl("Responsibilities"));
ch.push(twoCol("Role","Responsibility",arr(d.responsibilities).map(r=>[r.role,r.responsibility]),2700,6660));
if(d.responsibilities_note) ch.push(p(str(d.responsibilities_note),{italics:true,color:RED,before:60}));

ch.push(labelWithFlag("Trigger", d.trigger_flag));
ch.push(p(str(d.trigger)));

ch.push(lbl("Procedure"));
for(const it of arr(d.procedure)){
  if(it.kind==="phase") ch.push(p(str(it.text),{bold:true,before:80,after:60}));
  else if(it.kind==="step") ch.push(step(str(it.text)));
  else if(it.kind==="ifthen") ch.push(ifthen(it.if,it.then));
  else ch.push(bullet(str(it.text))); // default: bullet
}

ch.push(labelWithFlag("Done when", d.done_when_flag));
ch.push(p(str(d.done_when)));

// optional: Exceptions & Escalation
if(arr(d.exceptions).length){
  ch.push(lbl("Exceptions & Escalation"));
  ch.push(twoCol("Situation","Action / who to contact",arr(d.exceptions).map(e=>[e.situation,e.action]),3400,5960));
}
// optional: Troubleshooting (table) OR N/A note
if(arr(d.troubleshooting).length){
  ch.push(lbl("Troubleshooting"));
  ch.push(threeCol(["Symptom","Likely cause","Fix"],arr(d.troubleshooting).map(t=>[t.symptom,t.cause,t.fix]),[3120,3120,3120]));
} else if(d.troubleshooting_na){
  ch.push(runsP([new TextRun({text:"Troubleshooting",bold:true}),
    new TextRun({text:"  - N/A ("+str(d.troubleshooting_na)+")",italics:true,color:GREY,size:22})],{before:150,after:40}));
}
// optional: Success Metrics (table) OR N/A note
if(arr(d.metrics).length){
  ch.push(lbl("Success Metrics"));
  if(d.metrics_note) ch.push(p(str(d.metrics_note),{italics:true,color:RED,after:60}));
  ch.push(threeCol(["Metric","Target","How measured"],arr(d.metrics).map(m=>[m.metric,m.target,m.method]),[3120,1600,4640]));
} else if(d.metrics_na){
  ch.push(runsP([new TextRun({text:"Success Metrics",bold:true}),
    new TextRun({text:"  - N/A ("+str(d.metrics_na)+")",italics:true,color:GREY,size:22})],{before:150,after:40}));
}
// optional: References
if(arr(d.references).length){
  ch.push(lbl("References"));
  for(const r of arr(d.references)) ch.push(bullet(str(r)));
}
// optional: Records created / storage location
if(arr(d.records).length){
  ch.push(lbl("Records created / storage location"));
  for(const r of arr(d.records)) ch.push(bullet(str(r)));
}

}

// shared: Revision Log (closes the document)
ch.push(h2("Revision Log",{pageBreakBefore:true}));
(function(){
  const w=[1600,1000,2100,4660].map(sc);
  const head=headerRow(["Date","Ver.","Changed by","What changed"].map((t,i)=>cell(t,{w:w[i],fill:NAVY,color:"FFFFFF",bold:true})));
  const rows=arr(d.revision_log);
  const body=(rows.length?rows:[{date:"",ver:"",by:"",change:""}]).map((r,ri)=>{const f=ri%2===1?BAND:undefined;return new TableRow({children:[
    cell(r.date,{w:w[0],fill:f}),cell(r.ver,{w:w[1],fill:f}),cell(r.by,{w:w[2],fill:f}),cell(r.change,{w:w[3],fill:f})]});});
  ch.push(new Table({width:{size:w.reduce((x,y)=>x+y,0),type:WidthType.DXA},columnWidths:w,rows:[head,...body]}));
})();

return ch;
}

// ---- styles / numbering (exported for reuse) ----
const styles={default:{document:{run:{font:"Aptos",size:22}}},paragraphStyles:[
    {id:"Heading1",name:"Heading 1",basedOn:"Normal",next:"Normal",quickFormat:true,
      run:{size:32,bold:true,font:"Aptos",color:NAVY},paragraph:{spacing:{before:120,after:40},outlineLevel:0}},
    {id:"Heading2",name:"Heading 2",basedOn:"Normal",next:"Normal",quickFormat:true,
      run:{size:26,bold:true,font:"Aptos",color:BLUE},paragraph:{spacing:{before:240,after:100},outlineLevel:1}},
    {id:"Heading3",name:"Heading 3",basedOn:"Normal",next:"Normal",quickFormat:true,run:{size:24,bold:true,font:"Aptos",color:"000000"},paragraph:{spacing:{before:280,after:60},outlineLevel:2}}]};
const numbering={config:[
    {reference:"bul",levels:[{level:0,format:LevelFormat.BULLET,text:"\u2022",alignment:AlignmentType.LEFT,
      style:{paragraph:{indent:{left:540,hanging:280}}}}]},
    {reference:"bul2",levels:[{level:0,format:LevelFormat.BULLET,text:"\u2022",alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:1240,hanging:300}}}}]},
    {reference:"stp",levels:[{level:0,format:LevelFormat.DECIMAL,text:"%1.",alignment:AlignmentType.LEFT,
      style:{paragraph:{indent:{left:540,hanging:320}}}}]},
    ...Array.from({length:12},(_,i)=>({reference:"n"+(i+1),levels:[{level:0,format:LevelFormat.DECIMAL,text:"%1.",alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:760,hanging:320}}}}]}))]};

function buildDoc(d){
  const mode=(str(d.mode)||"procedure").toLowerCase();
  return new Document({
  creator:"Active Alarm Company, Inc.",
  title:str(d.title)||"AAC SOP",
  styles,
  numbering,
  sections:[{
    properties:{page:{size:{width:12240,height:15840},margin:{top:1080,right:720,bottom:1080,left:720,header:540,footer:540}}},
    headers:{default:new Header({children:[new Paragraph({alignment:AlignmentType.RIGHT,spacing:{after:0},
      border:{bottom:{style:BorderStyle.SINGLE,size:4,color:LINE,space:4}},
      children:[new TextRun({text:"Active Alarm Company, Inc.  |  "+(mode==="work_instruction"?"Work Instruction":"SOP"),size:16,color:GREY})]})]})},
    footers:{default:new Footer({children:[new Paragraph({spacing:{before:0},
      tabStops:[{type:TabStopType.RIGHT,position:CW}],
      children:[new TextRun({text:"Confidential. Online document. A printed copy is valid only on the day it is printed.",size:16,color:GREY}),
        new TextRun({text:"\tPage ",size:16,color:GREY}),
        new TextRun({children:[PageNumber.CURRENT],size:16,color:GREY})]})]})},
    children:buildChildren(d)}]
  });
}

module.exports = { buildChildren, buildDoc, styles, numbering, docx: require('docx') };

if(require.main===module){
  const inPath=process.argv[2], outPath=process.argv[3]||"SOP.docx";
  if(!inPath){console.error("Usage: node build_sop.js <input.json> <output.docx>");process.exit(1);}
  const d=JSON.parse(fs.readFileSync(inPath,'utf8'));
  Packer.toBuffer(buildDoc(d)).then(b=>{fs.writeFileSync(outPath,b);console.log("Wrote "+outPath+" ("+b.length+" bytes)");});
}
