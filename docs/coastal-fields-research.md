# Shallow-coast density fields: literature basis

_Saved 2026-10-05 from the research subagent report (full text in its transcript: `brain/a98bcb59-02e5-44e5-9369-f879b9da67fe/.system_generated/logs/transcript.jsonl`). This file keeps the decision-relevant tables and every evidence tag. Nothing here was read beyond abstract level._

## 요약
온대 유럽 얕은 연안(조간대~천해)의 자연 지반을 밀도 필드로 나눴다: 거머리말, 대형 갈조류 캐노피, 패류초, 염습지/사구 가장자리, 바이오필름, 면 전체 상태변수인 용존산소, 그리고 일시 블룸인 파래. 시계(8 h = 10^6 yr, 로그 압축)에서는 절대 속도가 아니라 **순위**만 쓴다. "통과 횟수–식생 피복" 곡선은 육상 식생에서만 곡선형(포화형)이 확인되고, 연안 다중 용량 곡선은 찾지 못했다. 히스테리시스는 Carr et al. 2010에 근거해 "과거 부하가 회복률을 낮춘다"는 규칙으로 구현할 수 있다.

## Evidence key
| Tag | Meaning |
|---|---|
| [V] | abstract/record text read through Crossref or PubMed API (no publisher full text reachable) |
| [B] | bibliographic record verified (title, first author, year, DOI); the claim was NOT read |
| [S] | seen only in a search-engine summary |
| [U] | unverified, from memory or unconfirmed attribution |

## Fields: rank order (1 = fastest recovery / most trampling-sensitive)
| Field | Recovery rank | Trampling sensitivity rank | Litter / smothering | Strength |
|---|---|---|---|---|
| Biofilm (microphytobenthos) | 1 (days) | 5 (least) | bags → anoxic sediment, fewer infauna (Green 2015 [V]) | low–medium [S] |
| Canopy algae (Fucus/Laminaria) | 2 (1–5 yr) | 3 | no temperate study verified | medium–low [B/S] |
| Eelgrass (Zostera marina) | 3 (shoots months, meadow yr–decades) | 2 | shading/anoxia; Balestri 2017 [V] shows effects are not simple | medium |
| Marsh/dune fringe | 4 | 2–3 | tyres/pots on Spartina persist >14 months (Uhrin & Schellinger 2011 [V]) | medium–low |
| Mussel/oyster bed | 5 (yr–decades) | 1 | smothering; may also host growth on litter (hypothesis) | low–medium |
| Dissolved oxygen (state) | onset days–weeks; benthos recovery yr | n/a | food waste and bags add oxygen demand (inference from Green 2015) | medium [V Diaz & Rosenberg 2008] |
| Ulva bloom (event overlay) | days | n/a | n/a | medium [V Smetacek & Zingone 2013; Ye 2011] |

Coral does not fit generic temperate Europe (Cladocora is a Mediterranean special case; cold-water Lophelia is deep). Lamb et al. 2018 (Science, DOI 10.1126/science.aar3320) only as an analogue: plastic-draped coral had much higher disease likelihood. The "4 % → 89 %" figure is [S].

## Dose–response (what is and is not supported)
- Standard trampling protocol: Cole & Bayfield 1993 [B]; passes 0/25/75/200/500 are common designs; Talbot et al. 2003 abstract confirms such designs were used across ecosystems [V].
- Functional form: curvilinear/asymptotic, most loss at low doses (Cole 1995 I & II [B]; numbers [S]).
- Recovery: Pescott & Stewart 2014 meta-analysis (PeerJ, DOI 10.7717/peerj.360 [V]) — recovery depends on initial resistance, recovery time and life form, **not strongly on trampling intensity**.
- Coastal-specific: only point comparisons (Garmendia 2017 on Zostera noltei, DOI 10.3989/scimar.04482.17a [V]). **No verified multi-dose curve for any marine field.**

Model proposal (design, not from a paper): per-tick loss `-s_i · F · P/(P+P50)`, litter loss `-b_i · L · F`, recovery `r_i · F · (1-F) + ε` with `r_i` by rank and an extra history term (below).

## History-dependent recovery
Carr et al. 2010 (DOI 10.1029/2009jg001103 [V]): seagrass is stable above 2.2 m depth and bistable at 2.2–3.6 m depending on initial cover, through sediment-resuspension and light feedbacks. Rule: `r_eff = r0 · M · S(F_neighbours)`, with a damage memory `M` rising with cumulative load and decaying slowly. Apply mainly to seagrass and mussel/oyster; let canopy algae and biofilm recover almost independently of history.

## Marine litter: land vs sea
- The "80 % land-based" figure traces to GESAMP 1990 and covered all pollutants, not litter [S]. Critique: Hudson, Gilardi & Vousden 2025, Frontiers in Marine Science, DOI 10.3389/fmars.2025.1587805 [B]. The attribution to Hardesty/Wilcox in a search summary is [U].
- Jambeck et al. 2015: 4.8–12.7 Mt plastic entered the ocean from land in 2010 (DOI 10.1126/science.1260352 [V]); land inputs only.
- JRC European beach data: item shares must be checked in the JRC table itself; search summaries disagree (single-use share 43 % vs 50 %) [S].

## Hard remains and taphonomy (design, titles only)
Shells survive best, then teeth, then bone. Kidwell 2002 [B]; Zuschin et al. 2003 [B]; Behrensmeyer 1978 [B].

## Korean alternative set (secondary)
Eelgrass (Z. marina; Lee, Park & Kim 2007 [B]), Ulva prolifera green tide (Liu 2013 [B]; Ye 2011 [V]), Sargassum horneri golden tide [S], oyster, Korean beach-litter monitoring (Hong et al. 2014 [B]).

## Key gaps
No marine multi-dose trampling curve; almost no quantitative litter-on-seagrass/kelp/mussel effects; most recovery times are [S]; JRC and GESAMP numbers unverified; Korean data mostly [S]/[B]; Wernberg et al. 2016 not confirmed in Crossref (do not cite).

## Conceptual references (all [B])
Morton 2013 *Hyperobjects*; Steinberg & Peters 2015 "Wet ontologies" (DOI 10.1068/d14148p); Neimanis 2017 *Bodies of Water*; Alaimo 2012 "States of Suspension" (DOI 10.1093/isle/iss068); Zalasiewicz et al. 2014 (DOI 10.1177/2053019613514953) and 2016 (DOI 10.1016/j.ancene.2016.01.002); Corcoran, Moore & Jazvac 2014 (DOI 10.1130/gsat-g198a.1); Zettler et al. 2013 (DOI 10.1021/es401288x); Haraway 2015 (DOI 10.1215/22011919-3615934); Liboiron 2021 *Pollution Is Colonialism*.
