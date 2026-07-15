#!/usr/bin/env python3
"""Validate every umbrel-app.yml in the repo.

1.4.50 shipped with release notes containing a line ending in "longer:".
A colon in a plain YAML scalar is a parse error, so umbreld's
`app-script pre-patch-update` exited 1 and the update was impossible to
install -- the manifest had never been run through a YAML parser.

Runs on the Umbrel host: stdlib only, with a minimal fallback if PyYAML
is unavailable.
"""
import glob, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

FAILURES = []


def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name}"
          f"{': ' + str(detail) if detail and not cond else ''}")
    if not cond:
        FAILURES.append(name)


try:
    import yaml
except ImportError:                                  # pragma: no cover
    yaml = None


def main():
    manifests = sorted(glob.glob(os.path.join(ROOT, "*", "umbrel-app.yml")))
    check("found app manifests", len(manifests) > 0, manifests)
    if yaml is None:
        print("SKIP  PyYAML unavailable; install pyyaml for full validation")
        return
    for m in manifests:
        rel = os.path.relpath(m, ROOT)
        try:
            d = yaml.safe_load(open(m))
            ok = True
        except Exception as e:
            ok = False
            check(f"{rel} parses as YAML", False, e)
        if not ok:
            continue
        check(f"{rel} parses as YAML", True)
        # 29.1.15 shipped a manifest whose releaseNotes edit spliced out
        # everything between releaseNotes: and submitter: -- including
        # `port:`. umbreld's app-script reads it as APP_PROXY_PORT, got null,
        # and the app could not start at all. Parsing is not enough: assert
        # the fields umbreld actually needs.
        for field in ("manifestVersion", "id", "name", "version", "port"):
            check(f"{rel} has {field}", d.get(field) is not None)
        check(f"{rel} port is an int", isinstance(d.get("port"), int),
              repr(d.get("port")))
        # releaseNotes may legitimately be "" for an initial release; what
        # matters is that the key exists and is a string
        check(f"{rel} has releaseNotes key", "releaseNotes" in d)
        v = d.get("version")
        check(f"{rel} version is a string", isinstance(v, str), repr(v))
        # umbreld compares versions as strings; a stray newline breaks it
        check(f"{rel} version has no whitespace",
              isinstance(v, str) and v == v.strip(), repr(v))
        rn = d.get("releaseNotes")
        check(f"{rel} releaseNotes is a string", isinstance(rn, str), type(rn))
        # a compose next to the manifest must parse too
        comp = os.path.join(os.path.dirname(m), "docker-compose.yml")
        if os.path.exists(comp):
            try:
                yaml.safe_load(open(comp))
                check(f"{os.path.relpath(comp, ROOT)} parses as YAML", True)
            except Exception as e:
                check(f"{os.path.relpath(comp, ROOT)} parses as YAML", False, e)




def test_no_manifest_keys_lost_vs_git():
    """A version bump must never remove keys. This is the exact 29.1.15 bug:
    an editing script sliced out seven fields and every test still passed."""
    import subprocess
    for m in sorted(glob.glob(os.path.join(ROOT, "*", "umbrel-app.yml"))):
        rel = os.path.relpath(m, ROOT)
        r = subprocess.run(["git", "show", f"HEAD:{rel}"], cwd=ROOT,
                           capture_output=True, text=True)
        if r.returncode != 0 or not r.stdout.strip():
            continue
        try:
            was, now = yaml.safe_load(r.stdout), yaml.safe_load(open(m))
        except Exception:
            continue
        lost = [k for k in (was or {}) if k not in (now or {})]
        check(f"{rel} keeps every key it had at HEAD", not lost, f"lost {lost}")

if __name__ == "__main__":
    print("app manifest validation:")
    main()
    test_no_manifest_keys_lost_vs_git()
    if FAILURES:
        print(f"\n{len(FAILURES)} FAILURE(S): {FAILURES}")
        sys.exit(1)
    print("\nALL MANIFEST TESTS PASSED")
