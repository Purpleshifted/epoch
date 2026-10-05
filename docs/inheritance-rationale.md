# Inheritance rule — why what you scatter depends on what is already there

_요약: 방문자가 뿌리는 물건의 종류는 고정된 비율이 아니라, 그 자리에 **남아 있는** 것의 구성에 영향을 받는다. 사라진 것은 물려받지 않는다._

Status: implemented in `apps/web/src/lib/stratum/sample.ts` (`fieldWeights`, `sampleFromField`) and
`field.ts` (`localSurvivors`); wired into `DepositField`. Tests: `lib/stratum/field.test.ts`.

## 1. The rule

```
p(item) = ( k · prior(item) + survivors(item) ) / ( k + survivors_total )
```

- `prior(item)`: the catalogue frequency (JRC 2016 European beach litter, see `scatter-catalogue.md`).
- `survivors(item)`: number of items of that type **still present** (not `vanished`) within radius `R` of the
  visitor. Buried and fossil items count; vanished items do not.
- `k`: prior pseudo-count (Leva, default 20). `R`: radius of the ground one inherits from (Leva, default 4 world units).
- The weight of the ground is `n / (n + k)`. On empty ground the draw is the plain catalogue prior; the more has
  accumulated, the more the local composition decides. `k = 0` follows the ground only; large `k` ignores it.
- This is a Pólya urn with a Dirichlet prior (Dirichlet-multinomial).

**The visitor still does not choose.** The draw is not behaviour; it is what the place hands over.

## 2. Why this fits the work

1. **Ecological inheritance** (Odling-Smee, Laland & Feldman 2003): organisms modify their environment and
   descendants inherit the modified conditions without choosing them. "I do not decide what I leave; I inherit what
   others left, and my leaving is conditioned by it."
2. **Survivorship drives the drift.** Soft, organic and short-lived items vanish quickly; durable plastics stay.
   Because only survivors are counted, the composition that the next visitor inherits drifts toward the durable,
   without anyone deciding it. This is the same bias that shapes the fossil record (taphonomic bias), and a
   small-scale model of why the Anthropocene stratum is plastic-rich.
3. **Positive feedback** (Pólya urn; Arthur's increasing returns) gives path dependence: early accidents of who
   walked where can make a corner of the field "a plastic place" or "a string place".

## 3. Literature

Verification key: **[S]** bibliographic data and gist confirmed from search-engine summaries of the source pages
(not the full text); **[mem]** from memory, not checked this session. No paper below was read in full.

| Work | What it says | Role here | Status |
|---|---|---|---|
| Odling-Smee, Laland & Feldman (2003), *Niche Construction: The Neglected Process in Evolution*, Princeton UP | Niche construction; ecological inheritance = legacy of modified selection pressures passed on through the environment | Core rationale: inheriting what others left, unchosen | [S] |
| Cialdini, Reno & Kallgren (1990), "A focus theory of normative conduct…", *JPSP* 58(6):1015–1026 | A littered environment cues a descriptive norm and increases littering | Environment state affects the next act of leaving things | [S] |
| Keizer, Lindenberg & Steg (2008), "The spreading of disorder", *Science* | Visible disorder (litter, graffiti) increases other norm violations | Same direction as above | [S] |
| Kidwell & Jablonski (1983), "Taphonomic feedback: ecological consequences of shell accumulation", in Tevesz & McCall (eds.), *Biotic Interactions in Recent and Fossil Benthic Communities* | Accumulated hard parts change the seafloor and affect later colonisation and their own preservation | Stratigraphic precedent: deposits condition later deposits | [S] |
| Schiffer (1987), *Formation Processes of the Archaeological Record*, Univ. of New Mexico Press | Cultural formation processes; primary / secondary / de facto refuse | Precedent: the way refuse accumulates shapes the record | [S] |
| Pauly (1995), "Anecdotes and the shifting baseline syndrome of fisheries", *TREE* 10(10):430 | Each generation takes the already-altered state as the baseline | Predecessors' composition becomes the next baseline | [S] |
| Eggenberger & Pólya (1923), "Über die Statistik verketteter Vorgänge", *ZAMM* 3:279–289 | Urn model where an occurrence raises the probability of its repetition | The mathematical mechanism | [S] |
| Arthur (1989), "Competing technologies, increasing returns, and lock-in by historical events", *Economic Journal* 99(394):116–131 | Increasing returns, path dependence, lock-in by small early events | Path dependence and its lock-in risk | [S] |
| Haff (2014), "Humans and technology in the Anthropocene: Six rules", *The Anthropocene Review* | The technosphere as a quasi-autonomous geological-scale system; individuals have little influence on large technological systems | Systems view of "no individual decides" | [S] partial. A search summary garbled the list of rules, so no individual rule is cited |
| Barabási & Albert (1999), "Emergence of scaling in random networks", *Science* 286:509 | Preferential attachment | Related rich-get-richer mechanism | [mem] |
| Jones, Lawton & Shachak (1994), "Organisms as ecosystem engineers", *Oikos* 69:373 | Ecosystem engineering | Related to niche construction | [mem] |
| Wilson & Kelling (1982), "Broken windows", *The Atlantic* | Visible disorder invites more disorder | Background to Keizer / Cialdini | [mem] |

A search summary also claimed that on beaches existing debris traps new debris and creates hotspots. The source
pages were not opened, so this is **not** used as evidence.

## 4. Limits, stated plainly

- Cialdini and Keizer measure **how much** people litter. None of the sources found measure **which types**
  accumulate where. The type-level effect ("the ground's composition shifts my draw") is an **artistic design
  choice** that the literature motivates but does not prove. Say so in any public text.
- Behavioural norm theories assume a choosing visitor. Ours does not choose, so the rationale should lean on
  inheritance and stratigraphy (rows 1 and 4), not on norm psychology.
- Positive feedback can lock one type in. `k` is the safeguard; it is a Leva control so the lock-in can be tuned
  by eye.
- `k = 20` and `R = 4` are starting values (**EST.**), not calibrated.

## 5. Not decided yet

- A **background supply** of organic matter (the world dropping leaves, bones, shells at a steady rate, independent
  of visitors) so that the natural layer is renewed and then decays. Proposed, not chosen.
- The **electronics** and **organic** parts of the catalogue. Until they exist, the prior is the JRC top 50 only,
  and the "drift toward the durable" effect shows among plastics only (film / foam / cordage vs rigid / fragment).
- Whether buried items should count fully when a visitor reads "the ground", or only the surface.
