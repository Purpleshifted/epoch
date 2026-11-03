(function(){
  var log = [];
  var S = "$SCRATCH";
  var base = new File(S + "/ai/base.ai");
  var pdf = new File(S + "/print/B_print.pdf");
  var outAi = new File("/Volumes/Hesse/exhibition/anthropocene/.claude/worktrees/a0-poster-design-89bf0a/poster-a0/out/A0_poster_B.ai");
  var outPng = new File("/Volumes/Hesse/exhibition/anthropocene/.claude/worktrees/a0-poster-design-89bf0a/poster-a0/out/A0_poster_B_preview.png");
  app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
  while (app.documents.length) app.documents[0].close(SaveOptions.DONOTSAVECHANGES);
  // 1. the template
  var doc = app.open(base);
  log.push("template: " + doc.width + "x" + doc.height + " pt, layers " + doc.layers.length + ", items " + doc.pageItems.length);
  // the grey safe box must not print
  var removed = 0;
  for (var i = doc.pathItems.length - 1; i >= 0; i--) { var p = doc.pathItems[i]; if (p.width > 2000 && p.height > 2800 && p.filled && !p.clipping) { p.remove(); removed++; } }
  log.push("grey box removed: " + removed);
  // the footer: this poster's names, in white on the dark ground
  var white = new CMYKColor(); white.cyan = 0; white.magenta = 0; white.yellow = 0; white.black = 0;
  for (var t = 0; t < doc.textFrames.length; t++) {
    var tf = doc.textFrames[t], c = tf.contents;
    if (c.indexOf("Yelin Lim") >= 0) { tf.contents = "Hayeon Park, 20220875"; tf.textRange.characterAttributes.fillColor = white; tf.textRange.characterAttributes.textFont = app.textFonts.getByName("RedditSans-Medium"); log.push("footer right set"); }
    else if (c.indexOf("Supervised by") >= 0) { tf.contents = "Supervised by Prof. Yiyun Kang"; tf.textRange.characterAttributes.fillColor = white; tf.textRange.characterAttributes.textFont = app.textFonts.getByName("RedditSans-Medium"); log.push("footer left set"); }
    else if (c.indexOf("Graduation Design Studio") >= 0) { tf.textRange.characterAttributes.textFont = app.textFonts.getByName("RedditSans-Medium"); log.push("header font set"); }
  }
  // keep the right-aligned footer flush right: re-anchor after the contents change
  for (var t2 = 0; t2 < doc.textFrames.length; t2++) { var f = doc.textFrames[t2]; if (f.contents.indexOf("Hayeon Park") >= 0) { var right = 816.66 / 25.4 * 72; f.left = right - f.width; } }
  // 2. the poster, pasted in place on its own layer at the bottom
  var pdoc = app.open(pdf);
  app.activeDocument = pdoc;
  pdoc.selectObjectsOnActiveArtboard();
  app.copy();
  pdoc.close(SaveOptions.DONOTSAVECHANGES);
  app.activeDocument = doc;
  var lay = doc.layers.add(); lay.name = "Poster";
  doc.activeLayer = lay;
  app.executeMenuCommand("pasteInPlace");
  lay.zOrder(ZOrderMethod.SENDTOBACK);
  log.push("poster pasted: items now " + doc.pageItems.length);
  // 3. CMYK; blacks as K (the ground as a two-ink cool black), no four-ink blacks on vectors
  app.executeMenuCommand("doc-color-cmyk");
  var ground = new CMYKColor(); ground.cyan = 35; ground.magenta = 0; ground.yellow = 0; ground.black = 100;
  var k = new CMYKColor(); k.cyan = 0; k.magenta = 0; k.yellow = 0; k.black = 100;
  var fixed = 0, grounds = 0;
  for (var j = 0; j < doc.pathItems.length; j++) {
    var q = doc.pathItems[j];
    if (!q.filled || q.clipping) continue;
    var fc = q.fillColor;
    if (q.width > 2200 && q.height > 2500) {   // the ground: a page-wide dark fill (gradient or near-black); the white sky stays
      var dark = (fc.typename == "GradientColor") || (fc.typename == "CMYKColor" && fc.black > 50) || (fc.typename == "RGBColor" && fc.red < 60);
      if (dark) { q.fillColor = ground; grounds++; }
      continue;
    }
    if (fc.typename == "CMYKColor" && fc.black > 70 && fc.cyan > 50 && fc.magenta > 50 && fc.yellow > 50) { q.fillColor = k; fixed++; }
  }
  log.push("ground fills → C35 K100: " + grounds + "; four-ink blacks → K100: " + fixed);
  // 4. save: .ai with PDF compatibility, and a small preview
  var opts = new IllustratorSaveOptions(); opts.pdfCompatible = true; opts.embedLinkedFiles = true; opts.compressed = true;
  doc.saveAs(outAi, opts);
  var png = new ExportOptionsPNG24(); png.horizontalScale = 20; png.verticalScale = 20; png.antiAliasing = true; png.artBoardClipping = true;
  doc.exportFile(outPng, ExportType.PNG24, png);
  log.push("saved " + outAi.fsName);
  return log.join("\n");
})();
