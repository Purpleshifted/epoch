(function(){
  var log = [];
  var S = "$SCRATCH";
  var base = new File(S + "/ai/base.ai");
  var pdf = new File(S + "/print/B_print_gray.pdf");
  var outAi = new File("/Volumes/Hesse/exhibition/anthropocene/.claude/worktrees/a0-poster-design-89bf0a/poster-a0/out/A0_poster_B_K.ai");
  var outPng = new File("/Volumes/Hesse/exhibition/anthropocene/.claude/worktrees/a0-poster-design-89bf0a/poster-a0/out/A0_poster_B_K_preview.png");
  app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
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
  var ground = new CMYKColor(); ground.cyan = 0; ground.magenta = 0; ground.yellow = 0; ground.black = 100;
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
  // 3b. the PDF's shading became a non-native object: replace it with a native two-ink black inside the staircase clip
  for (var n = doc.nonNativeItems.length - 1; n >= 0; n--) { var nn = doc.nonNativeItems[n]; if (nn.width > 2200 && nn.height > 2500) { log.push("non-native " + Math.round(nn.width/72*25.4) + "x" + Math.round(nn.height/72*25.4) + " removed"); nn.remove(); } }
  var gclip = null;
  for (var j2 = 0; j2 < doc.pathItems.length; j2++) { var p2 = doc.pathItems[j2]; if (p2.clipping && p2.width > 2400 && p2.pathPoints.length > 100) { gclip = p2; break; } }
  if (gclip) { var gg = gclip.parent, bb = gclip.geometricBounds; var gr = gg.pathItems.rectangle(bb[1], bb[0], bb[2] - bb[0], bb[1] - bb[3]); gr.filled = true; gr.fillColor = ground; gr.stroked = false; gr.name = "ground C35 K100"; gr.zOrder(ZOrderMethod.SENDTOBACK); gclip.zOrder(ZOrderMethod.BRINGTOFRONT); log.push("ground rect added in a clip of " + gclip.pathPoints.length + " points, " + Math.round(gclip.width/72*25.4) + "x" + Math.round(gclip.height/72*25.4) + " mm"); } else log.push("ground clip not found");
  // (the images arrive as DeviceGray from pdf_gray.py and stay K-only; nothing to convert)
  // 3c. fonts: every text frame must resolve (the pasted captions use Neo둥근모; the template uses Reddit Sans)
  var missing = 0;
  for (var t3 = 0; t3 < doc.textFrames.length; t3++) { try { var nmf = doc.textFrames[t3].textRange.characterAttributes.textFont.name; } catch (e) { missing++; } }
  log.push("text frames " + doc.textFrames.length + ", unresolved fonts " + missing);
  // 4. save: .ai with PDF compatibility, and a small preview
  var opts = new IllustratorSaveOptions(); opts.pdfCompatible = true; opts.embedLinkedFiles = true; opts.compressed = true;
  doc.saveAs(outAi, opts);
  var png = new ExportOptionsPNG24(); png.horizontalScale = 20; png.verticalScale = 20; png.antiAliasing = true; png.artBoardClipping = true;
  doc.exportFile(outPng, ExportType.PNG24, png);
  log.push("saved " + outAi.fsName);
  // 5. the submission copy: all text as outlines (the guide's rule 5)
  doc.selectObjectsOnActiveArtboard();
  app.executeMenuCommand("outline");
  doc.selection = null;
  doc.saveAs(new File("/Volumes/Hesse/exhibition/anthropocene/.claude/worktrees/a0-poster-design-89bf0a/poster-a0/out/A0_poster_B_K_outlined.ai"), opts);
  log.push("outlined copy saved; text frames left " + doc.textFrames.length);
  return log.join("\n");
})();
