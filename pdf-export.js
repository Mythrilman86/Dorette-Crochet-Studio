/* Dorette Crochet Studio PDF Export v1.0.0
   Offline vector PDF generator. No external scripts, accounts, images, or server required.
   Cells are stored top-to-bottom; printed row numbers count bottom-to-top. */
(() => {
  'use strict';
  const encoder = new TextEncoder();
  const PAGE_SIZES = {letter:[612,792],a4:[595.28,841.89]};
  const CELL_SIZES = {compact:10,normal:12,large:14};
  const rgb = hex => [1,3,5].map(i => (parseInt(hex.slice(i,i+2),16)/255).toFixed(3));
  const fmt = n => Number(n.toFixed(2)).toString();
  const formatInt = n => n.toLocaleString('en-US');
  const safeName = name => String(name||'Crochet Chart').replace(/[\u0000-\u001f]/g,' ').slice(0,100);
  // Built-in PDF Helvetica uses WinAnsi. Convert punctuation and accented Latin letters
  // to WinAnsi octals, falling back to ? for characters it cannot represent.
  function pdfText(value){
    const extra = {'€':128,'‚':130,'ƒ':131,'„':132,'…':133,'†':134,'‡':135,'ˆ':136,
      '‰':137,'Š':138,'‹':139,'Œ':140,'Ž':142,'‘':145,'’':146,'“':147,'”':148,
      '•':149,'–':150,'—':151,'˜':152,'™':153,'š':154,'›':155,'œ':156,'ž':158,'Ÿ':159};
    let out='';
    for(const c of String(value)){
      let n=c.codePointAt(0);
      if(n<32) n=32;
      const mapped=extra[c]!==undefined;
      if(mapped)n=extra[c];
      if(n>255 || (!mapped && n>=127 && n<160)) n=63;
      if(n===40||n===41||n===92) out+='\\'+String.fromCharCode(n);
      else if(n>126)out+='\\'+n.toString(8).padStart(3,'0');
      else out+=String.fromCharCode(n);
    }
    return '('+out+')';
  }
  function validated(p){
    if(!p||!Number.isInteger(p.cols)||!Number.isInteger(p.rows)||p.cols<1||p.rows<1||
      p.cols>200||p.rows>300||!Array.isArray(p.cells)||p.cells.length!==p.cols*p.rows||
      !Array.isArray(p.palette)||!p.palette.length||p.palette.length>12||
      p.palette.some(c=>!c||!/^#[a-f\d]{6}$/i.test(c.hex)||typeof c.symbol!=='string')||
      p.cells.some(x=>!Number.isInteger(x)||x<0||x>=p.palette.length))throw new Error('The selected project contains invalid chart data.');
    return p;
  }
  function plan(project,options={}){
    const p=validated(project),paper=PAGE_SIZES[options.paper]||PAGE_SIZES.letter;
    const landscape=options.orientation==='landscape';
    const W=landscape?paper[1]:paper[0],H=landscape?paper[0]:paper[1];
    const cell=CELL_SIZES[options.detail]||CELL_SIZES.normal;
    // Every shared section boundary may repeat this many neighboring stitches.
    // Repeats are never counted in the overall yarn legend or completed stitch total.
    const overlap=[0,1,2,3].includes(Number(options.overlap))?Number(options.overlap):0;
    const margin=38,gridTop=165,gridBottom=H-105,gridLeft=margin+32,gridRight=W-margin-32;
    // Establish the number of pages using their physical capacity, THEN divide
    // the whole pattern evenly across those pages. The old implementation used
    // full-width sections followed by a nearly empty last section (e.g.
    // columns 1-39, 40-78, 79-117, 118-120). For 120 columns this now creates
    // four 30-column sections when overlap is OFF; overlap can add pages.
    const capacityCols=Math.max(1,Math.floor((gridRight-gridLeft)/cell));
    const capacityRows=Math.max(1,Math.floor((gridBottom-gridTop)/cell));
    // Allow room for overlap on BOTH edges of an interior section. This may
    // increase the number of pages, but never shrinks the chosen stitch squares.
    const across=Math.ceil(p.cols/Math.max(1,capacityCols-2*overlap));
    const down=Math.ceil(p.rows/Math.max(1,capacityRows-2*overlap));
    const perCols=Math.ceil(p.cols/across),perRows=Math.ceil(p.rows/down);
    return {W,H,cell,margin,gridTop,gridBottom,gridLeft,gridRight,perCols,perRows,across,down,pages:2+across*down,
      paper:options.paper==='a4'?'a4':'letter',orientation:landscape?'landscape':'portrait',
      monochrome:!!options.monochrome,completed:!!options.completed,overlap};
  }
  // Main sections partition the chart exactly once. The printed bounds may
  // extend by a few cells in all four directions as labeled references.
  function sectionBounds(project,conf,sectionCol,sectionRow){
    const coreC0=sectionCol*conf.perCols,coreR0=sectionRow*conf.perRows;
    const coreC1=Math.min(project.cols,coreC0+conf.perCols);
    const coreR1=Math.min(project.rows,coreR0+conf.perRows);
    const c0=Math.max(0,coreC0-conf.overlap),r0=Math.max(0,coreR0-conf.overlap);
    const c1=Math.min(project.cols,coreC1+conf.overlap);
    const r1=Math.min(project.rows,coreR1+conf.overlap);
    return {c0,r0,countC:c1-c0,countR:r1-r0,coreC0,coreR0,
      coreCountC:coreC1-coreC0,coreCountR:coreR1-coreR0,
      firstC:coreC0+1,lastC:coreC1,firstR:project.rows-coreR1+1,lastR:project.rows-coreR0};
  }
  class Painter{
    constructor(W,H,mono=false){this.W=W;this.H=H;this.mono=mono;this.ops=[];this.lastFill='';this.lastStroke='';}
    shade(hex){if(!this.mono)return hex;const c=rgb(hex).map(v=>+v*255),l=Math.round(c[0]*.299+c[1]*.587+c[2]*.114);return '#'+[l,l,l].map(v=>v.toString(16).padStart(2,'0')).join('');}
    fill(hex){const v=rgb(this.shade(hex)).join(' ');if(this.lastFill!==v){this.ops.push(v+' rg');this.lastFill=v;}}
    stroke(hex){const v=rgb(this.shade(hex)).join(' ');if(this.lastStroke!==v){this.ops.push(v+' RG');this.lastStroke=v;}}
    rect(x,top,w,h,hex){this.fill(hex);this.ops.push(`${fmt(x)} ${fmt(this.H-top-h)} ${fmt(w)} ${fmt(h)} re f`);}
    line(x1,t1,x2,t2,hex='#d5d0dc',width=.4){this.stroke(hex);this.ops.push(`${fmt(width)} w ${fmt(x1)} ${fmt(this.H-t1)} m ${fmt(x2)} ${fmt(this.H-t2)} l S`);}
    outline(x,top,w,h,hex='#51416d',width=.85){this.stroke(hex);this.ops.push(`${fmt(width)} w ${fmt(x)} ${fmt(this.H-top-h)} ${fmt(w)} ${fmt(h)} re S`);}
    text(value,x,top,size=10,bold=false,color='#2f2943'){
      this.fill(color);this.ops.push(`BT /${bold?'F2':'F1'} ${fmt(size)} Tf 1 0 0 1 ${fmt(x)} ${fmt(this.H-top-size)} Tm ${pdfText(value)} Tj ET`);
    }
    center(value,cx,top,size=10,bold=false,color='#2f2943'){
      // Estimate Helvetica widths conservatively; labels are short and fixed-width-like.
      const width=String(value).length*size*(bold?.54:.50);
      this.text(value,cx-width/2,top,size,bold,color);
    }
    getStream(){return this.ops.join('\n')+'\n';}
  }
  function cropText(s,max=75){const name=safeName(s);return name.length>max?name.slice(0,max-3)+'...':name;}
  function chrome(g,title,sub,project,position,total){
    g.rect(0,0,g.W,8,'#7055ad');
    g.text('DORETTE  /  CROCHET STUDIO',g.W>680?44:38,22,10,true,'#7156a5');
    g.text(cropText(title,g.W>680?75:57),g.W>680?44:38,43,17,true);
    g.text(sub,g.W>680?44:38,70,9,false,'#756b82');
    g.line(38,96,g.W-38,96,'#e4dbe9',.8);
    g.line(38,g.H-47,g.W-38,g.H-47,'#e4dbe9',.7);
    g.text(cropText(project.name,47),38,g.H-36,8,false,'#766781');
    g.text(`Page ${position} / ${total}`,g.W-102,g.H-36,8,true,'#766781');
  }
  function countColors(p){const counts=Array(p.palette.length).fill(0);p.cells.forEach(i=>counts[i]++);return counts;}
  function finishedCount(p){
    let count=0;for(let row=0;row<p.rows;row++)for(let col=0;col<p.cols;col++){
      const idx=row*p.cols+col;if(p.done?.[idx]||p.rowDone?.[p.rows-row-1])count++;
    }
    return count;
  }
  // Coalesce adjacent same-color cells into single filled PDF rectangles.
  function paintRuns(g,p,c0,r0,ncols,nrows,x,y,cell,mono=false){
    for(let r=0;r<nrows;r++){
      const offset=(r0+r)*p.cols+c0;
      let from=0;
      while(from<ncols){
        const ci=p.cells[offset+from];let end=from+1;
        while(end<ncols&&p.cells[offset+end]===ci)end++;
        if(mono){g.rect(x+from*cell,y+r*cell,(end-from)*cell,cell,'#ffffff');}
        else g.rect(x+from*cell,y+r*cell,(end-from)*cell,cell,p.palette[ci].hex);
        from=end;
      }
    }
  }
  function overview(g,p,conf,counts){
    chrome(g,'Full chart overview',`${p.cols} columns x ${p.rows} rows  |  ${formatInt(p.cols*p.rows)} stitches`,p,1,conf.pages);
    const spanW=g.W-100,spanH=g.H-274;
    const scale=Math.min(spanW/p.cols,spanH/p.rows);
    const w=p.cols*scale,h=p.rows*scale;
    const x=(g.W-w)/2,y=120+(spanH-h)/2;
    const source=conf.monochrome?{...p,palette:p.palette.map(c=>{const v=rgb(c.hex).map(n=>+n*255);const lum=Math.round(v[0]*.299+v[1]*.587+v[2]*.114);const gray=Math.round(165+lum*.36).toString(16).padStart(2,'0');return {...c,hex:'#'+gray.repeat(3)};})}:p;
    paintRuns(g,source,0,0,p.cols,p.rows,x,y,scale,false);
    g.outline(x,y,w,h,'#665277',.8);
    g.center(`Columns 1 - ${p.cols}`,g.W/2,y+h+7,9,true);
    g.text(`Row ${p.rows}`,Math.max(10,x-42),y,8,true);
    g.text('Row 1',Math.max(10,x-42),y+h-13,8,true);
    g.text('Overview for reference only: use the numbered section pages for individual stitches.',38,g.H-124,9);
    const done=finishedCount(p);
    g.text(`${formatInt(done)} / ${formatInt(p.cols*p.rows)} stitches completed in app (${Math.round(done/(p.cols*p.rows)*100)}%)`,38,g.H-106,9);
    g.text(`Full yarn-color key and stitch totals: see page 2 (${p.palette.length} yarn colors).`,38,g.H-87,8);
    g.text(`${conf.paper.toUpperCase()}  |  ${conf.orientation}  |  ${conf.across} x ${conf.down} sections  |  ${conf.monochrome?'Black and white':'Color'}  |  Overlap: ${conf.overlap} stitches`,38,g.H-69,8);
  }
  function legendPage(g,p,conf,counts){
    chrome(g,'Yarn color & symbol legend','Use these letters to identify the yarn color in each square.',p,2,conf.pages);
    g.text('STITCH COLOR KEY',42,118,11,true,'#7156a5');
    g.rect(42,143,g.W-84,27,'#f4f0f8');
    const twoColumns=g.H<690 && p.palette.length>=7;
    if(twoColumns){
      const half=(g.W-84)/2;
      for(const left of [42,42+half]){
        g.text('SYMBOL',left+7,150,8.4,true);
        g.text('YARN COLOR',left+61,150,8.4,true);
        g.text('STITCHES',left+half-58,150,8.4,true);
      }
    }else{
      g.text('SYMBOL',57,150,9,true);g.text('YARN COLOR',127,150,9,true);
      g.text('STITCHES',g.W-170,150,9,true);g.text('%',g.W-77,150,9,true);
    }
    const legendRows=twoColumns?Math.ceil(p.palette.length/2):p.palette.length;
    const cellh=twoColumns?34:Math.min(36,(g.H-300)/Math.max(1,legendRows));
    p.palette.forEach((c,i)=>{
      const col=twoColumns?Math.floor(i/legendRows):0;
      const row=twoColumns?i%legendRows:i;
      const half=(g.W-84)/2;
      const left=42+(col*half),top=177+row*cellh;
      const width=twoColumns?half-5:g.W-84;
      const txtSize=Math.min(9.5,cellh*.34);
      if(row%2===0)g.rect(left,top,width,cellh,'#faf8fb');
      g.rect(left+7,top+7,19,Math.max(13,cellh-13),c.hex);
      g.outline(left+7,top+7,19,Math.max(13,cellh-13),'#b1a6bd',.5);
      g.text(c.symbol,left+33,top+7,10,true);
      if(twoColumns){
        g.text(cropText(c.name,16),left+58,top+5,8.2);
        g.text(c.hex,left+58,top+19,7,false,'#84788c');
        g.text(formatInt(counts[i]),left+width-52,top+9,8.6,true);
      }else{
        g.text(cropText(c.name,28),127,top+7,txtSize);
        g.text(c.hex,127,top+20,7,false,'#84788c');
        g.text(formatInt(counts[i]),g.W-168,top+8,9,true);
        g.text((counts[i]*100/(p.cols*p.rows)).toFixed(1)+'%',g.W-76,top+8,8);
      }
    });
    const bottom=177+legendRows*cellh+18;
    g.line(42,bottom,g.W-42,bottom,'#e5ddeb');
    g.text('HOW TO READ THIS PATTERN',42,bottom+12,11,true,'#7156a5');
    const rules=[
      'Each square represents one stitch. The letter identifies its yarn color.',
      'Column 1 is on the LEFT; columns increase toward the right.',
      'Row 1 is at the BOTTOM; row numbers increase upward.',
      conf.overlap?`Purple border = main stitches. Outside: ${conf.overlap}-stitch overlap, reference only.`:'Each detail page is a section of the full chart, with absolute row/column numbers.',
      conf.monochrome?'Black-and-white export: read the letter in each square.':'Color export: letter symbols are printed over the yarn colors.'
    ];
    rules.forEach((t,i)=>g.text(`${i+1}. ${t}`,42,bottom+33+i*18,8.5));
  }
  function detailPage(g,p,conf,sectionCol,sectionRow,pageNumber){
    const b=sectionBounds(p,conf,sectionCol,sectionRow);
    const {c0,r0,countC,countR,firstC,lastC,firstR,lastR}=b;
    chrome(g,`Chart section ${sectionRow+1}.${sectionCol+1}`,
      `Main: Columns ${firstC}-${lastC}  |  Rows ${firstR}-${lastR} (bottom-up numbering)`,p,pageNumber,conf.pages);
    g.text(`Section ${sectionCol+1} of ${conf.across} across; ${sectionRow+1} of ${conf.down} down.`,38,110,9,false,'#6a5d78');
    if(conf.overlap){
      g.text(`Purple outline = main stitches; outside = repeated reference stitches (up to ${conf.overlap}).`,38,128,8,true,'#6e4895');
    }
    const cell=conf.cell;
    // The complete print area (main plus neighboring reference cells) must fit
    // in the same safe area regardless of page size or orientation.
    const x=conf.gridLeft+(conf.gridRight-conf.gridLeft-countC*cell)/2;
    const y=conf.gridTop+(conf.gridBottom-conf.gridTop-countR*cell)/2;
    paintRuns(g,p,c0,r0,countC,countR,x,y,cell,conf.monochrome);
    // Per-stitch yarn symbols. Print in both color and black-and-white exports.
    const glyph=Math.min(7.2,Math.max(5.8,cell*.52));
    for(let r=0;r<countR;r++)for(let c=0;c<countC;c++){
      const id=(r0+r)*p.cols+c0+c,ci=p.cells[id],sym=p.palette[ci].symbol;
      const hex=p.palette[ci].hex,rc=parseInt(hex.slice(1,3),16),gc=parseInt(hex.slice(3,5),16),bc=parseInt(hex.slice(5,7),16);
      const dark=!conf.monochrome && (rc*.299+gc*.587+bc*.114)<148;
      g.center(sym,x+(c+.5)*cell,y+r*cell+(cell-glyph)/2-1,glyph,true,dark?'#ffffff':'#211b29');
      if(conf.completed&&(p.done?.[id]||p.rowDone?.[p.rows-r0-r-1])){
        g.line(x+c*cell+cell-3,y+r*cell+2,x+c*cell+cell-1,y+r*cell+4,conf.monochrome?'#333333':'#2d8c5d',.9);
      }
    }
    const w=countC*cell,h=countR*cell;
    // Grid line boundaries extend to the numbered row/column gutters.
    for(let c=0;c<=countC;c++){
      const xx=x+c*cell;
      g.line(xx,y-10,xx,y+h+10,'#b6afbf',.34);
    }
    for(let r=0;r<=countR;r++){
      const yy=y+r*cell;
      g.line(x-16,yy,x+w+16,yy,'#b6afbf',.34);
    }
    g.outline(x,y,w,h,'#5b457a',.8);
    if(conf.overlap){
      // Distinguish duplicate edge cells without changing any yarn colors or
      // overprinting their symbols. Thick border encloses the UNIQUE section.
      const mainX=x+(b.coreC0-c0)*cell,mainY=y+(b.coreR0-r0)*cell;
      g.outline(mainX,mainY,b.coreCountC*cell,b.coreCountR*cell,'#8150bc',2.2);
    }
    // Number all columns at top and bottom; all rows at left and right.
    const numSize=Math.min(6.5,Math.max(5.2,cell*.50));
    for(let c=0;c<countC;c++){
      const cx=x+(c+.5)*cell,label=String(c0+c+1);
      g.center(label,cx,y-22,numSize,true);
      g.center(label,cx,y+h+10,numSize,true);
    }
    for(let r=0;r<countR;r++){
      const label=String(p.rows-(r0+r)),yy=y+(r+.5)*cell-numSize/2;
      g.text(label,x-27,yy,numSize,true);
      g.text(label,x+w+8,yy,numSize,true);
    }
    g.text(conf.overlap?'OUTSIDE PURPLE OUTLINE: repeated stitches, for reference only.':'Continue with neighboring chart sections as needed.',38,g.H-75,7.8,false,'#78668e');
    g.text(conf.overlap?'Row 1 begins at the bottom. Never crochet duplicate overlap cells twice.':'Row 1 is at the bottom of the full chart.',38,g.H-62,7.8,false,'#78668e');
  }
  function pdfBuilder(pages,metadata){
    const objs=[''];
    const add = v=>{objs.push(v);return objs.length-1;};
    const catalog=add(''),root=add(''),font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),fontBold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const ids=[];
    for(const g of pages){
      const content=g.getStream();const len=encoder.encode(content).length;
      const stream=add(`<< /Length ${len} >>\nstream\n${content}endstream`);
      const page=add(`<< /Type /Page /Parent ${root} 0 R /MediaBox [0 0 ${fmt(g.W)} ${fmt(g.H)}] /Resources << /Font << /F1 ${font} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${stream} 0 R >>`);
      ids.push(page);
    }
    objs[catalog]=`<< /Type /Catalog /Pages ${root} 0 R >>`;
    objs[root]=`<< /Type /Pages /Kids [${ids.map(x=>x+' 0 R').join(' ')}] /Count ${ids.length} >>`;
    const info=add(`<< /Title ${pdfText(metadata.title.replace(/[—–]/g,'-'))} /Creator ${pdfText('Dorette Crochet Studio 1.0.0')} /Producer ${pdfText('Dorette local PDF export')} >>`);
    const output=[encoder.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
    // Header bytes over 127 above are encoded as UTF-8; the marker is informational only.
    const offsets=[0];let offset=output[0].length;
    for(let i=1;i<objs.length;i++){
      offsets[i]=offset;
      const part=encoder.encode(`${i} 0 obj\n${objs[i]}\nendobj\n`);
      output.push(part);offset+=part.length;
    }
    const xref=offset;
    let tail=`xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for(let i=1;i<objs.length;i++)tail+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
    tail+=`trailer\n<< /Size ${objs.length} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    output.push(encoder.encode(tail));
    const length=output.reduce((n,b)=>n+b.length,0),bytes=new Uint8Array(length);let i=0;
    for(const b of output){bytes.set(b,i);i+=b.length;}
    return bytes;
  }
  function build(project,options={}){
    const p=validated(project),conf=plan(p,options),counts=countColors(p),pages=[];
    const first=new Painter(conf.W,conf.H,conf.monochrome);overview(first,p,conf,counts);pages.push(first);
    const legend=new Painter(conf.W,conf.H,conf.monochrome);legendPage(legend,p,conf,counts);pages.push(legend);
    for(let row=0;row<conf.down;row++)for(let col=0;col<conf.across;col++){
      const detail=new Painter(conf.W,conf.H,conf.monochrome);detailPage(detail,p,conf,col,row,pages.length+1);pages.push(detail);
    }
    return {bytes:pdfBuilder(pages,{title:safeName(p.name)+' - Crochet Chart'}),pages:conf.pages};
  }
  // Written colorwork PDF uses the same saved grid as the numbered chart PDF.
  // No source photo, API, cloud service or online library is required.
  function buildWritten(project,options={}){
    const p=validated(project),pt=window.DorettePattern;
    if(!pt)throw Error('Row instruction module is missing');
    pt.ensure(p);
    const paper=PAGE_SIZES[options.paper]||PAGE_SIZES.letter,landscape=options.orientation==='landscape';
    const W=landscape?paper[1]:paper[0],H=landscape?paper[0]:paper[1];
    const pages=[],make=()=>{const g=new Painter(W,H,false);pages.push(g);return g;};
    const counts=pt.counts(p),gauge=p.gauge||{},firstDir=p.workDirection.first==='ltr'?'Left to right':'Right to left';
    let g=make();
    // Cover page: project details, directions, palette and optional inventory.
    g.text('WORKING DIRECTIONS',43,118,12,true,'#7156a5');
    g.text(`Project: ${cropText(p.name,65)}`,43,144,11,true);
    g.text(`Chart: ${p.cols} columns x ${p.rows} rows (${formatInt(p.cols*p.rows)} stitches)`,43,166,10);
    g.text(`Row 1 begins at BOTTOM; first row: ${firstDir}.`,43,189,10);
    g.text(p.workDirection.alternate!==false?'Working direction ALTERNATES every row.':'Use the SAME direction for every row.',43,211,10);
    g.text('Read each color block in the stated working direction. Example: "8 A, 3 B"',43,238,9);
    g.text('means 8 consecutive stitches in yarn A, then 3 in yarn B.',43,256,9);
    g.text('A row checkbox is for your pencil; your saved app progress is unchanged.',43,283,9);
    g.line(42,313,W-42,313,'#dcd3e8');
    g.text('YARN COLOR KEY / UNIQUE STITCH COUNTS',43,328,11,true,'#7156a5');
    let y=358;
    p.palette.forEach((color,i)=>{
      if(i>=12)return;
      const info=p.yarnInfo?.[i]||{};
      g.rect(44,y+1,16,15,color.hex);g.outline(44,y+1,16,15,'#8f829a',.35);
      g.text(`${color.symbol}  ${cropText(color.name,36)}`,70,y,9,true);
      g.text(`${formatInt(counts[i])} stitches`,W-150,y,9);
      if(info.brand||info.code||info.dyeLot)g.text(cropText(`${info.brand||''} ${info.code||''} ${info.dyeLot?'lot '+info.dyeLot:''}`,70),71,y+15,7,false,'#8c7e98');
      y+=((info.brand||info.code||info.dyeLot)?36:27);
    });
    if(y+90<H-85){
      g.line(42,y+8,W-42,y+8,'#dcd3e8');
      g.text('YARN USAGE ESTIMATE',43,y+21,10,true,'#7156a5');
      const sample=Number(gauge.swatchYards)||0;
      g.text(sample>0?`Based on your measured swatch: ${gauge.swatchStitches} stitches used ${sample} yards; ${gauge.overage||0}% allowance.`:'No measured swatch entered. Yardage cannot be calculated from stitch counts alone.',43,y+43,8.3);
    }
    // Add all rows, in crocheting order: Row 1 at bottom -> Row N at top.
    g=make();y=117;
    function newPage(){g=make();y=117;}
    const safeChars=Math.max(55,Math.floor((W-92)/(9.1*.55)));
    for(let row=1;row<=p.rows;row++){
      const direction=pt.direction(p,row)==='rtl'?'RIGHT to LEFT':'LEFT to RIGHT';
      const runs=pt.runs(p,row),tokens=runs.map(r=>`${r.count} ${p.palette[r.color].symbol}`);
      const lines=[];let line='';
      for(const token of tokens){
        if(!line)line=token;
        else if(line.length+3+token.length<=safeChars)line+='  |  '+token;
        else{lines.push(line);line=token;}
      }
      if(line)lines.push(line);
      const required=30+lines.length*12+9;
      if(y+required>H-91)newPage();
      const done=p.rowDone?.[row-1]||Array.from({length:p.cols},(_,c)=>p.done?.[(p.rows-row)*p.cols+c]).every(Boolean);
      g.outline(44,y+3,11,11,done?'#7356ab':'#988aa6',.8);
      if(done)g.text('X',46,y,10,true,'#654a96');
      g.text(`Row ${row} / ${p.rows}  |  ${direction}  |  ${p.cols} stitches  |  ${runs.length} blocks`,65,y-1,10,true);
      y+=19;
      for(const l of lines){g.text(l,65,y,9,false,'#2b2437');y+=12;}
      g.line(44,y+4,W-44,y+4,'#e8e1ec',.35);y+=16;
    }
    const total=pages.length;
    pages.forEach((pg,i)=>chrome(pg,i===0?'Written row-by-row instructions':'Written colorwork — rows',i===0?'Crochet in the direction printed for each row.':'Consecutive same-color stitches are grouped into runs.',p,i+1,total));
    return {bytes:pdfBuilder(pages,{title:safeName(p.name)+' - Written Colorwork'}),pages:total};
  }

  window.DorettePdf=Object.freeze({build,plan,sectionBounds,buildWritten});
})();
