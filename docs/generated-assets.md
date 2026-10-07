# AI-generated assets (provenance)

The picture fragments and the concrete texture used by the Side/Top "photo" collage are **AI-generated**
(image-generation tool inside the Antigravity assistant, October 2026). They are not photographs and not
copies of any third-party work.

| Files | What | Made by |
| --- | --- | --- |
| `apps/web/public/fragments/frag_*.png` (10) | side fragments of brutalist concrete architecture, cut out from white | generated → `tools/fragments/build_fragments.py` |
| `apps/web/public/fragments/top_*.png` (5) | top-down plan fragments, cut out from white | same |
| `apps/web/public/textures/concrete_board.jpg` | tileable board-formed concrete, greyscale 512² | generated → same script |

Rebuild: `PYTHONPATH=<pillow/numpy/scipy> python3 tools/fragments/build_fragments.py <dir-with-source-jpgs>`
(the source JPGs are not committed).

## Open legal points (not legal advice)

- Copyright in purely AI-generated output is uncertain (no protection without human authorship in the US and
  Korea; EU unsettled). Treat the images as *possibly unprotected*, not as "owned".
- The image tool's terms of service for commercial / exhibition use were **not checked**. Check before a public show.
- The visual references in `visual_reference_images/` are third-party works, are git-ignored and are not embedded.
- Fallback if needed: replace with CC0 material (ambientCG, Poly Haven; see `free-assets-concrete-cigarettes.md`).
