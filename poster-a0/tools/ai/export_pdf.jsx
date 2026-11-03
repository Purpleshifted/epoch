(function(){
  var log = [];
  app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
  var src = new File("$SCRATCH/ai/artist.ai");
  var out = new File("$SCRATCH/ai/artist_zip.pdf");
  var doc = app.open(src);
  log.push("opened " + doc.name + " | mode " + doc.documentColorSpace + " | artboard " + Math.round(doc.width/72*25.4) + "x" + Math.round(doc.height/72*25.4) + " mm | artboards " + doc.artboards.length);
  // the guide: CMYK, every text outlined, images embedded
  if (doc.documentColorSpace != DocumentColorSpace.CMYK) { app.executeMenuCommand("doc-color-cmyk"); log.push("converted to CMYK"); }
  var unresolved = 0; for (var t = 0; t < doc.textFrames.length; t++) { try { doc.textFrames[t].textRange.characterAttributes.textFont.name; } catch (e) { unresolved++; } }
  log.push("text frames " + doc.textFrames.length + " (unresolved fonts " + unresolved + ")");
  for (var L = 0; L < doc.layers.length; L++) { doc.layers[L].locked = false; doc.layers[L].visible = true; }
  if (doc.textFrames.length) { doc.selectObjectsOnActiveArtboard(); app.executeMenuCommand("outline"); doc.selection = null; log.push("outlined → text frames left " + doc.textFrames.length); }
  var notEmbedded = 0; for (var r = 0; r < doc.rasterItems.length; r++) if (!doc.rasterItems[r].embedded) notEmbedded++;
  log.push("rasters " + doc.rasterItems.length + " (not embedded " + notEmbedded + "), placed " + doc.placedItems.length);
  for (var pI = doc.placedItems.length - 1; pI >= 0; pI--) { try { doc.placedItems[pI].embed(); log.push("embedded a placed item"); } catch (e) {} }
  // PDF with Illustrator editing kept, no downsampling, no colour conversion
  var o = new PDFSaveOptions();
  o.preserveEditability = true;
  o.compatibility = PDFCompatibility.ACROBAT7;
  o.colorDownsamplingMethod = DownsampleMethod.NODOWNSAMPLE;
  o.grayscaleDownsamplingMethod = DownsampleMethod.NODOWNSAMPLE;
  o.monochromeDownsamplingMethod = DownsampleMethod.NODOWNSAMPLE;
  o.colorCompression = CompressionQuality.ZIP8BIT;
  o.grayscaleCompression = CompressionQuality.ZIP8BIT;
  o.compressArt = true;
  o.optimization = false;
  o.generateThumbnails = false;
  o.viewAfterSaving = false;
  o.trimMarks = false; o.registrationMarks = false; o.colorBars = false; o.pageInformation = false;
  o.bleedLink = true; o.offset = 0;
  doc.saveAs(out, o);
  log.push("saved " + out.fsName);
  doc.close(SaveOptions.DONOTSAVECHANGES);
  return log.join("\n");
})();
