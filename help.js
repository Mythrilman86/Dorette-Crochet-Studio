/* Local, non-blocking section help. No project data is read or written. */
(() => {
  const topics=[
    ['.chart-layout-controls','Single or dual charts','Single chart hides the overview and expands the working chart across the available width. Dual charts shows both views again (stacked on compact screens). Switching keeps your zoom, viewing center, selection, edits and crochet progress. Your view choice is remembered in this browser on this device, separately from project backups.'],
    ['.panel-heading','Projects','Choose a saved project or create one with a name, columns and rows. Projects save in this browser on this device. Renaming is in Chart settings. Back up important work as ZIP files.'],
    ['.toolbar','Chart navigation','The left overview always fits the whole chart. Tap or drag there to select a stitch and center the right chart. The orange dashed box shows the visible working area. Zoom with +/−, a wheel or a two-finger pinch. Choose Pan to move the working chart. Fit chart resets its zoom; Center recenters it. Mirror chart flips the stitches, progress marks and reference image left to right. Use Undo to reverse it.'],
    ['.stitch-editor','Editing tools','Select inspects a stitch. Paint draws the chosen yarn; Erase uses the first yarn color; Pick samples an existing color. Rectangle fills a dragged box; Fill bucket recolors a connected region. Select area then Copy area or Fill area. Paste uses the tapped stitch as the top-left anchor. Undo and Redo reverse edits; Save snapshot keeps up to three recovery points.'],
    ['.guide-head','Guided Crochet Mode','These controls stay inline without covering the chart. Complete & next stitch marks the current stitch and advances in your chosen row direction. Previous stitch moves back without removing progress. Row buttons move to the start of the neighboring row. Hide controls collapses this panel; Guided Crochet Mode opens it again at the saved position. The live dashboard also mirrors the current guide row and stitch.'],
    ['.selection-bar','Selection and progress','Both charts show the same selected row, column, stitch and selected area. Turn on Mark stitch, then tap or drag in either chart. Start on an incomplete square to mark or on a completed square to unmark. Mark row toggles the entire selected row. Green shading shows completed work and never changes the saved yarn color underneath. Row 1 is at the bottom and column 1 is at the left.'],
    ['#patternLock','Crochet mode and tablet safety','Pattern lock protects the chart from accidental recoloring while you crochet. Stylus mode lets a pen draw while finger touches only pan or select, which helps on tablets. Larger touch buttons increases the size of many controls for easier tapping.'],
    ['#textInput','Text to chart','Type letters, words, dates or symbols, choose horizontal or vertical placement, select a size and a yarn color, then preview. Use the arrow buttons to nudge the preview around the chart. Apply text converts the preview into stitches; Undo removes it if needed.'],

    ['.work-instructions > summary','Row instructions','Choose the first row direction and whether rows alternate. Show row or the row buttons choose a row. Counts group consecutive stitches of each yarn in working order. These are yarn-color instructions; use your chosen crochet stitch technique.'],
    ['.inspector-heading','Chart settings','Change the project name here. Enter columns (1–200) and rows (1–300), then Apply dimensions. Read the resize confirmation carefully and make a ZIP backup before changing the size of an important chart.'],
    ['#photoCropPanel .section-title','Crop photograph','Drag the corner handles or use trim percentages to remove unwanted surroundings. Reset restores the full image. The T-shirt preset is a starting point; adjust it for your photo. Image placement determines how the crop fits the chart.'],
    ['.photo-enhance-panel .section-title','Photo cleanup','Use Clean printed artwork for lettering and flat artwork, or Natural image palette for ordinary photos. Adjust brightness, contrast, light text threshold, red/blue sensitivity and fine lettering boost, then preview. Reset cleanup restores defaults.'],
    ['.yarn-manager > summary','Yarn inventory','Measure a real swatch: enter stitches made, yards used and extra yarn percentage. Enter each yarn brand, color code, dye lot, skeins owned and yards per skein. Estimates use chart stitch counts and the measured sample; actual use depends on tension and technique.'],
  ];
  // Locate semantic sections rather than relying on their layout position.
  document.querySelectorAll('.inspector-section').forEach(section=>{
    const label=section.querySelector('.eyebrow')?.textContent.trim();
    const extra={
      'STITCH PROGRESS':['Stitch progress','The counter includes individually completed stitches and completed rows, counting each stitch once. Unmark a completed row before trying to remove progress on a stitch within that row.'],
      'IMAGE TO CHART':['Import and conversion','Import a photo or chart image, crop it and choose yarn colors and preview size. Preview stitches shows a temporary result in both charts. Apply chart commits it; Discard keeps the saved chart. Compare sizes lets you inspect lettering before choosing. Reference opacity adjusts the photo overlay. Grayscale mode converts busy images into black, gray and white only.'],
      'YARN COLOR LEGEND':['Yarn colors','The legend links letters, yarn names, colors and stitch counts. Choose Color for editing or a yarn swatch above the chart. Paint selected stitch changes one selected square. Add color adds a new yarn to the palette.'],
      'PRINTABLE PDF EXPORT':['PDF exports','Choose Letter or A4, orientation, stitch size and page overlap. The page count updates automatically. Black & white prints yarn letters; completed marks are optional. Printable PDF includes overview, legend and tiled chart pages. Written instructions PDF groups yarn counts for each row in the chosen direction. Overlap repeats edge stitches for alignment; do not crochet them twice.'],
      'SAVE & BACK UP':['Saving and backups','Autosave keeps work in this browser. Back up this project or Back up all creates a ZIP for manual storage in Google Drive. Restore accepts older Dorette ZIP backups and creates new copies. Keep backups private. Updating the app at the same GitHub Pages address preserves its browser storage; clearing site data removes local projects.']
    }[label];
    if(extra)topics.push([section.querySelector('.eyebrow'),...extra]);
  });
  let n=0;
  for(const [target,title,body] of topics){
    const host=typeof target==='string'?document.querySelector(target):target;if(!host)continue;
    const button=document.createElement('button');button.type='button';button.className='help-button';button.textContent='?';button.setAttribute('aria-label','Help: '+title);button.setAttribute('aria-expanded','false');
    const panel=document.createElement('div');panel.id='section-help-'+(++n);panel.className='context-help';panel.hidden=true;panel.textContent=body;button.setAttribute('aria-controls',panel.id);
    host.append(button);const container=host.tagName==='SUMMARY'?host.parentElement:host;container.after(panel);
    button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));});
    panel.addEventListener('keydown',e=>{if(e.key==='Escape'){panel.hidden=true;button.setAttribute('aria-expanded','false');button.focus();}});
  }
  const link=document.createElement('a');link.className='guide-link';link.href='./Dorette-Crochet-Studio-User-Guide.pdf';link.textContent='Illustrated user guide (PDF)';link.target='_blank';link.rel='noopener';document.querySelector('.workspace-top').after(link);
})();
