(function(){
  var d = app.activeDocument, log = [];
  var mm = function(v){ return Math.round(v/72*25.4); }, pt = function(v){ return v / 25.4 * 72; };
  // the PDF's shading became a non-native object: say what it is, then replace it with a native two-ink black
  for (var n = d.nonNativeItems.length - 1; n >= 0; n--) { var nn = d.nonNativeItems[n]; log.push("non-native: " + mm(nn.width) + "x" + mm(nn.height) + " mm at " + mm(nn.left) + "," + mm(-nn.top)); if (nn.width > pt(800) && nn.height > pt(900)) { nn.remove(); log.push("  removed"); } }
  var target = null;
  for (var j = 0; j < d.pathItems.length; j++) { var p = d.pathItems[j]; if (p.clipping && mm(p.width) == 851 && mm(p.height) == 1006) { target = p; break; } }
  if (!target) return "no ground clip";
  var g = target.parent;
  var ground = new CMYKColor(); ground.cyan = 35; ground.magenta = 0; ground.yellow = 0; ground.black = 100;
  var b = target.geometricBounds; // [left, top, right, bottom], y up
  var r = g.pathItems.rectangle(b[1], b[0], b[2] - b[0], b[1] - b[3]);
  r.filled = true; r.fillColor = ground; r.stroked = false; r.name = "ground C35 K100";
  r.zOrder(ZOrderMethod.SENDTOBACK);
  log.push("ground rect: " + mm(r.width) + "x" + mm(r.height) + " mm at " + mm(r.left) + "," + mm(-r.top));
  // make sure the clip path still leads the group
  target.zOrder(ZOrderMethod.BRINGTOFRONT);
  var opts = new IllustratorSaveOptions(); opts.pdfCompatible = true; opts.embedLinkedFiles = true; opts.compressed = true;
  d.saveAs(new File("/Volumes/Hesse/exhibition/anthropocene/.claude/worktrees/a0-poster-design-89bf0a/poster-a0/out/A0_poster_B.ai"), opts);
  var png = new ExportOptionsPNG24(); png.horizontalScale = 20; png.verticalScale = 20; png.antiAliasing = true; png.artBoardClipping = true;
  d.exportFile(new File("/Volumes/Hesse/exhibition/anthropocene/.claude/worktrees/a0-poster-design-89bf0a/poster-a0/out/A0_poster_B_preview.png"), ExportType.PNG24, png);
  log.push("saved");
  return log.join("\n");
})();
