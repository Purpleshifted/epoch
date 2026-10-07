# Free concrete textures and cigarette photos (verified 2026-10-07)

Tags: [V] = I called the API / opened the page myself. Nothing here is legal advice.

## Concrete textures

| Source | Licence | Verified |
|---|---|---|
| ambientCG | CC0 1.0, credit optional (https://docs.ambientcg.com/license/) | [V] page read; API `https://ambientcg.com/api/v2/full_json?type=Material&q=concrete` returned the list |
| Poly Haven | CC0 (https://polyhaven.com/license) | [V] page read; API `https://api.polyhaven.com/assets?t=textures&c=concrete` returned the list |
| textures.com, Share Textures, Texture.ninja | restrictive / unclear redistribution | [S] avoid |

Download pattern for ambientCG (listed by the API): `https://ambientcg.com/get?file=<AssetId>_1K-JPG.zip` (use only the `_Color.jpg`).
Poly Haven: ask `https://api.polyhaven.com/files/<id>` for exact URLs.

Candidates that suit "cast / board-formed / precast" (names + tags from the APIs, look not yet checked by eye):
- ambientCG photogrammetry: `Concrete040` (brown rough), `Concrete025` (light grey), `Concrete013` (rough wall, waves), `Concrete047B` (outdoor, old).
- ambientCG "bunker, cast, concrete, gray" (procedural): `Concrete027`, `Concrete028`, `Concrete029`.
- Poly Haven: `ribbed_concrete_wall` (vertical grooves), `concrete_slab_wall_02` (precast panel), `concrete_slab_wall`, `patterned_concrete_wall`, `concrete_layers_02`, `concrete_wall_007`, `rebar_reinforced_concrete`.

No asset is tagged "board-formed"; the closest are the ribbed / precast-panel ones.

## Cigarette photos (Wikimedia Commons, `Category:Cigarette butts` and `Category:Cigarettes`, licence from extmetadata)

726 files scanned: CC BY-SA ~480 (avoid), CC BY ~110, Public domain 77, CC0 41, other 18.
Usable (CC0 / PD / CC-BY, no SA/NC/ND): 229 files, but many are audio/svg/ads; ~20 are photos of butts/cigarettes, e.g.
CC0: `Cigarette butt.jpg`, `Cigarettes in a pole.JPG`, `Cigarette - Malboro Advance.jpg`, `Camel Crush cigarette.jpg`.
PD: `Cigg.jpg`, `Okurki v tualete volgu.jpg`, `2008-10-21 10-11-20annajcoopercirclecigarettestub.JPG`.
CC BY (credit needed): `Cigarette on asphalt.jpg` (3.0), `Zigarettenstummel.jpg` (3.0), `Cigarettfimpar - 2021.jpg` (3.0), `Butt (4511714047).jpg` (2.0), `Ash tray.jpg` (2.0).
Full machine-readable list incl. URLs and authors: `scratch/commons_cigs.json` (script `scratch/commons_cigs.py`; not committed).

Rule used: accept CC0, PD, CC BY; reject any SA/NC/ND/GFDL; write author/licence/URL into a credits manifest for every CC BY file.
Unsplash/Pexels/Pixabay: free to use but not an open licence; committing raw photos to a public repo is a grey area. Avoid.
