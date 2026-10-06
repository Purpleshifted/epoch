"""Resolve the DOIs cited in docs/hybrid-objects-research.md against Crossref and print title / first author / year.

Usage: python3 tools/research/check_dois.py
A DOI that does not resolve, or whose title does not match the citation, must not be cited as-is.
"""
import json
import time
import urllib.error
import urllib.parse
import urllib.request

DOIS = {
    "Corcoran 2014 plastiglomerate": "10.1130/GSAT-G198A.1",
    "Corcoran & Jazvac 2020": "10.1038/s43017-019-0010-9",
    "Turner 2019 pyroplastic": "10.1016/j.scitotenv.2019.133610",
    "Gestoso 2019 plasticrust": "10.1016/j.scitotenv.2019.06.123",
    "Plastitar 2022": "10.1016/j.scitotenv.2022.156261",
    "Plastitar Med 2023": "10.1016/j.marpolbul.2023.115583",
    "Fernandino 2020 anthropoquinas": "10.1016/j.marpolbul.2020.111044",
    "Santos 2022 plastistone": "10.1016/j.marpolbul.2022.114031",
    "Ellrich 2023 plasticoncrete": "10.1016/j.scitotenv.2023.165073",
    "Zettler 2013 plastisphere": "10.1021/es401288x",
    "Ford 2014 made ground": "10.1144/SP395.12",
    "Owen 2025 anthropoclastic": "10.1130/G52895.1",
    "Rose 2015 SCP": "10.1021/acs.est.5b00543",
    "Swindles 2015 SCP": "10.1038/srep10264",
    "Brandon 2019 microplastic": "10.1126/sciadv.aax0587",
    "Zalasiewicz 2016 plastic": "10.1016/j.ancene.2016.01.002",
    "Young 2009 albatross": "10.1371/journal.pone.0007623",
    "Lamb 2018 coral": "10.1126/science.aar3320",
    "Glaser 2001 terra preta": "10.1007/s001140000193",
    "Zalasiewicz 2014 technofossil": "10.1177/2053019613514953",
    "Zalasiewicz 2017 technosphere": "10.1177/2053019616677743",
    "Waters 2016 Science": "10.1126/science.aad2622",
    "Zalasiewicz 2011": "10.1098/rsta.2010.0339",
    "Corcoran 2015 benthic": "10.1039/c5em00188a",
    "Haff 2014": "10.1144/SP395.4",
}

for name, doi in DOIS.items():
    url = "https://api.crossref.org/works/" + urllib.parse.quote(doi)
    req = urllib.request.Request(url, headers={"User-Agent": "anthropocene-research-check/0.1 (mailto:none@example.org)"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            m = json.load(r)["message"]
        title = (m.get("title") or ["?"])[0][:90]
        author = (m.get("author") or [{}])[0].get("family", "?")
        year = ((m.get("issued") or {}).get("date-parts") or [[None]])[0][0]
        print(f"OK   {name:32s} | {author} {year} | {title}", flush=True)
    except urllib.error.HTTPError as e:
        print(f"FAIL {name:32s} | {doi} | HTTP {e.code}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"ERR  {name:32s} | {doi} | {e}", flush=True)
    time.sleep(0.4)
