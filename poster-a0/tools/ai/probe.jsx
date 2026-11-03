(function(){
  var out = "Illustrator " + app.version + " | docs open: " + app.documents.length + " | fonts: " + app.textFonts.length;
  var want = ["Pretendard-Bold","Pretendard-Medium","SUIT-Heavy","NeoDunggeunmo","RedditSans-Medium","EBGaramond-Italic"];
  for (var i=0;i<want.length;i++){ var ok=false; try{ app.textFonts.getByName(want[i]); ok=true; }catch(e){} out += "\n" + want[i] + ": " + (ok?"yes":"no"); }
  return out;
})();
