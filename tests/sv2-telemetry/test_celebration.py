#!/usr/bin/env python3
"""Regression tests for the block-found celebration (Cash dashboard).

The visual is cosmetic; the GUARD is not. "Fires on every page load" or
"replays on refresh" is the one way this feature becomes hated instead of
loved, so the guard logic is executed for real under node.
"""
import os, re, subprocess, sys, tempfile, shutil, json

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
HTML = os.path.join(ROOT, "sslabs-solostrike-cash", "dashboard", "public", "index.html")
SRC = open(HTML).read()
FAILURES = []


def check(name, cond, detail=""):
    print(("PASS  " if cond else "FAIL  ") + name +
          ((": " + str(detail)) if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


def test_structure():
    check("overlay exists", 'id="celfx"' in SRC)
    check("toggle exists beside Found blocks", 'id="celebToggle"' in SRC)
    check("preview link exists (see it without finding a block)",
          'id="celebPreview"' in SRC)
    check("guard called from render before block rows",
          re.search(r"celebCheck\(d\.blockList\).*?getElementById\('blocksTable'\)", SRC, re.S) is not None)
    check("caption carries height, solve diff and protocol",
          'id="celH"' in SRC and 'id="celD"' in SRC and 'id="celP"' in SRC)
    check("both protocols labelled",
          "'Stratum V2':'Stratum V1'" in SRC)
    check("solve diff prefers solveDiff, falls back to best, dashes when unknown",
          "b.solveDiff||b.best||0" in SRC and "'\\u2014'" in SRC)


def test_brand_mark_single_source():
    """The mark must come FROM the page's own logo, not a copy: a brand
    restyle then follows through automatically."""
    check("mark path extracted from the header logo at runtime",
          'querySelector(\'svg.logo path[fill="url(#sscMark)"]\')' in SRC)
    check("cube face reuses the page's sscMark gradient",
          SRC.count('url(#sscMark)') >= 2)
    check("bills draw the real path via Path2D", "new Path2D(celMarkD)" in SRC)
    check("no generic unicode B glyph in the celebration",
          "\u20bf" not in SRC.split("celfx")[-1])


def test_no_3d_flatten():
    """filter on a preserve-3d ancestor flattens the cube (spec + iOS Safari).
    This shipped flat once in preview; keep it caught."""
    m = re.search(r"\.celcube\{[^}]*\}", SRC)
    check("celcube styles found", bool(m))
    check("no filter on the cube", bool(m) and "filter" not in m.group(0))
    scene = re.search(r"\.celscene\{[^}]*\}", SRC)
    stage = re.search(r"\.celstage\{[^}]*\}", SRC)
    check("no filter on 3D ancestors",
          all(x and "filter" not in x.group(0) for x in (scene, stage)))
    check("glow is a separate underlay, not a filter", ".celglow{" in SRC)


def test_hole_mechanics():
    check("hole position measured from the transformed face",
          "getBoundingClientRect" in SRC and ".celtop" in SRC)
    check("emission re-measures per tick (tracks the sway)",
          re.search(r"if\(celEmit>34\)\{celEmit=0;celLocate\(\);", SRC) is not None)
    check("bills canvas layered over the cube",
          re.search(r"\.celfx canvas\{[^}]*z-index:4", SRC) is not None)
    check("cube sways hole-up after the strike (no full spin)",
          "celsway" in SRC and not re.search(r"celcube[^}]*rotateY\(3[0-9]{2}deg\)", SRC))


def test_guard_behaviour():
    """Execute the real guard under node."""
    if not shutil.which("node"):
        print("SKIP  guard functional run (node unavailable on this host)")
        return
    m = re.search(r"/\* CELEB-GUARD-BEGIN \*/(.*?)/\* CELEB-GUARD-END \*/", SRC, re.S)
    check("guard block extractable", bool(m))
    if not m:
        return
    js = """
let fired=[]; let store={};
const localStorage={getItem:k=>store[k]||null,setItem:(k,v)=>{store[k]=String(v);}};
function celebFire(b){fired.push(b.hash||b.height);}
%s
// 1) first poll with two existing blocks: SEED, no fire
celebCheck([{hash:'aa',height:1},{hash:'bb',height:2}]);
const afterSeed=fired.length;
// 2) same list again: no fire
celebCheck([{hash:'aa',height:1},{hash:'bb',height:2}]);
const afterSame=fired.length;
// 3) one new block arrives: fire exactly once, for it
celebCheck([{hash:'cc',height:3},{hash:'aa',height:1},{hash:'bb',height:2}]);
const afterNew=fired.length, who=fired[0];
// 4) next poll, same list: no refire
celebCheck([{hash:'cc',height:3},{hash:'aa',height:1},{hash:'bb',height:2}]);
const afterHold=fired.length;
// 5) TWO new blocks in one poll: one celebration, the newest
celebCheck([{hash:'ee',height:5},{hash:'dd',height:4},{hash:'cc',height:3},{hash:'aa',height:1},{hash:'bb',height:2}]);
const afterTwo=fired.length, who2=fired[fired.length-1];
// 6) reload simulation: fresh state seeds silently over the full list
celebSeen=null;
celebCheck([{hash:'ee',height:5},{hash:'dd',height:4},{hash:'cc',height:3}]);
const afterReload=fired.length;
// 7) toggle off: new block, no fire
store['celebOff']='1';
celebCheck([{hash:'ff',height:6},{hash:'ee',height:5}]);
const afterOff=fired.length;
console.log(JSON.stringify({afterSeed,afterSame,afterNew,who,afterHold,afterTwo,who2,afterReload,afterOff}));
""" % m.group(1)
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(js); pth = f.name
    r = subprocess.run(["node", pth], capture_output=True, text=True)
    try:
        d = json.loads(r.stdout.strip().split("\n")[-1])
    except Exception:
        check("guard functional run", False, (r.stdout + r.stderr)[:200]); return
    check("page load with existing blocks fires NOTHING", d["afterSeed"] == 0)
    check("unchanged list fires nothing", d["afterSame"] == 0)
    check("a new block fires exactly once", d["afterNew"] == 1 and d["who"] == "cc")
    check("no refire on the next poll", d["afterHold"] == 1)
    check("two new blocks in one poll = one celebration, the newest",
          d["afterTwo"] == 2 and d["who2"] == "ee")
    check("reload re-seeds silently (never replays)", d["afterReload"] == 2)
    check("toggle off suppresses firing", d["afterOff"] == 2)


if __name__ == "__main__":
    print("block-found celebration regression tests:")
    test_structure()
    test_brand_mark_single_source()
    test_no_3d_flatten()
    test_hole_mechanics()
    test_guard_behaviour()
    if FAILURES:
        print("\n%d FAILURE(S): %s" % (len(FAILURES), FAILURES))
        sys.exit(1)
    print("\nALL CELEBRATION TESTS PASSED")
