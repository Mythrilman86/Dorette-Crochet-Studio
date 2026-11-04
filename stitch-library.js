/* Original chart glyphs and instructions. Paths use a 48 × 48 viewBox. */
const stitchEntries = [
  ['ch','Chain','ch','Chain','M8 24a16 6 0 1 0 32 0a16 6 0 1 0-32 0',
    ['Yarn over.','Draw the yarn through the loop on the hook.'], 'Make ten chains for a practice foundation.'],
  ['sl','Slip stitch','ss','Slip stitch','M21 24a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
    ['Insert the hook into the target stitch.','Yarn over and pull through the stitch and the loop already on the hook.'], 'Join the last stitch of a round to its first stitch if the pattern calls for a join.'],
  ['sc','Single crochet','dc','Double crochet','M14 14l20 20m0-20L14 34',
    ['Insert the hook into the target stitch.','Yarn over and pull up a loop.','Yarn over and pull through both loops.'], 'Work across a row to make a dense practice swatch.'],
  ['hdc','Half double crochet','htr','Half treble crochet','M12 9h24M24 9v31',
    ['Yarn over.','Insert the hook and pull up a loop with a yarn over.','Yarn over and pull through all three loops.'], 'Work one in each stitch across a practice row.'],
  ['dc','Double crochet','tr','Treble crochet','M12 6h24M24 6v36m-8-19 16-6',
    ['Yarn over.','Insert the hook and pull up a loop with a yarn over.','Yarn over and pull through two loops.','Yarn over and pull through the last two loops.'], 'Try a row of these to compare its height with single crochet.'],
  ['tr','Treble crochet','dtr','Double treble crochet','M12 5h24M24 5v38m-8-24 16-6m-16 16 16-6',
    ['Yarn over twice.','Insert the hook and pull up a loop with a yarn over.','Yarn over and pull through two loops three times, one pair at a time.'], 'Use one in a practice row to see how a tall post opens the fabric.'],
  ['dtr','Double treble crochet','trtr','Triple treble crochet','M12 4h24M24 4v40m-8-27 16-6m-16 16 16-6m-16 16 16-6',
    ['Yarn over three times.','Insert the hook and pull up a loop with a yarn over.','Yarn over and pull through two loops four times, one pair at a time.'], 'Try it beside a treble to compare the extra height.'],
  ['sc2tog','Single crochet two together','dc2tog','Double crochet two together','M10 39L24 8l14 31',
    ['Insert the hook in the first stitch and pull up a loop.','Insert the hook in the next stitch and pull up a loop.','Yarn over and draw through all three loops.'], 'Work it near a row edge to decrease by one stitch.'],
  ['dc2tog','Double crochet two together','tr2tog','Treble crochet two together','M9 40L24 7l15 33M15 7h18M10 25h12m4 0h12',
    ['Start a US double crochet in the first stitch and stop after the first pull through two.','Start another in the next stitch and stop at the same point.','Yarn over and pull through the three remaining loops.'], 'Use one where the pattern shows two tall stitches merging at their tops.'],
  ['shell','Five double crochet shell','shell','Five treble crochet shell','M24 41L4 19m20 22L13 9m11 32V5m0 36L35 9M24 41l20-22',
    ['Locate the single stitch or space marked by the pattern.','Work five US double crochets into that same place.','Continue at the next stitch or space specified by your pattern.'], 'Try a shell in a chain space and watch the posts fan out. The legend sets the count.'],
  ['puff','Puff stitch','puff','Puff stitch','M24 43Q0 23 24 5Q48 23 24 43M24 5v38',
    ['Yarn over, insert in the indicated space and draw up a long loop.','Repeat in the same space for the number of loops your pattern specifies.','Yarn over and close the loops as directed by the pattern.'], 'Compare three draw-ups in one space with a taller or fuller puff in your own pattern.'],
  ['picot','Chain-three picot','picot','Chain-three picot','M12 39Q0 18 24 9Q48 18 36 39Z',
    ['Chain three.','Slip stitch into the base specified by the pattern to close the little loop.'], 'Use one between groups of stitches on a practice edging.'],
  ['flo','Front loop only','flo','Front loop only','M10 29Q24 9 38 29',
    ['Identify the two strands of the top V.','Insert under the strand nearer you and work the indicated stitch.'], 'Work a row this way to leave the other loop visible.'],
  ['blo','Back loop only','blo','Back loop only','M10 19Q24 39 38 19',
    ['Identify the two strands of the top V.','Insert under the strand farther from you and work the indicated stitch.'], 'Try alternating rows worked in the back loop for ribbing.'],
  ['fpdc','Front post double crochet','fptr','Front post treble crochet','M12 5h24M24 5v30q0 12 12 7m-20-20 16-6',
    ['Yarn over and insert front to back beside the post, then back to front on the other side.','Yarn over and pull a loop around the post.','Yarn over and pull through two loops twice.'], 'Work around a tall stitch in the previous row to raise a ridge.'],
  ['bpdc','Back post double crochet','bptr','Back post treble crochet','M12 5h24M24 5v30q0 12-12 7m4-20 16-6',
    ['Yarn over and insert back to front beside the post, then front to back on the other side.','Yarn over and pull a loop around the post.','Yarn over and pull through two loops twice.'], 'Alternate with front post stitches to practice textured ribbing.']
].map(([id,us,ukCode,uk,path,steps,example]) => ({id,us,ukCode,uk,path,steps,example}));

function searchStitches(query, terms = 'both') {
  const words = query.trim().toLowerCase().split(/\s+/);
  return stitchEntries.filter(stitch => {
    const fields = terms === 'us' ? [stitch.id, stitch.us] :
      terms === 'uk' ? [stitch.ukCode, stitch.uk] :
        [stitch.id, stitch.us, stitch.ukCode, stitch.uk];
    if (stitch.id === 'sl' && terms !== 'uk') fields.push('sl st', 'slip st');
    return words.every(word => fields.some(field => field.toLowerCase().includes(word)));
  });
}

if (typeof module !== 'undefined') module.exports = {stitchEntries, searchStitches};
