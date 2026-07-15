#!/usr/bin/env python3
"""Regression tests for the 2026-07-15 node-isolation incident.

WHAT HAPPENED: the BCHN app pinned getumbrel/tor:0.4.7.8 (Aug 2022, EOL). Its
directory-authority list is stale, so dir servers answer 404 "Consensus not
signed by sufficient number of requested authorities" and Tor sticks at 30%
bootstrap. With Tor dead, "All traffic via Tor" pointed bitcoind's -proxy at a
proxy that could never answer: every OUTBOUND connection failed, only inbound
clearnet peers remained, and the tip froze at 959650 for 15.7 hours while an
S19 XP mined a parent the network had abandoned ~87 blocks earlier. Nothing in
the UI said a word.

Three defences, one test each:
  1. Tor image is current and digest-pinned (matches official Umbrel apps)
  2. `full` mode is gated behind a live SOCKS5 probe -- never isolate the node
  3. A frozen tip is surfaced loudly instead of looking healthy
Python 3 stdlib only.
"""
import os, re, socket, subprocess, sys, threading

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
COMPOSE = os.path.join(ROOT, "sslabs-bitcoin-cash-node", "docker-compose.yml")
SERVER = os.path.join(ROOT, "dashboard", "server.js")
INDEX = os.path.join(ROOT, "dashboard", "public", "index.html")

FAILURES = []


def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name}"
          f"{': ' + str(detail) if detail and not cond else ''}")
    if not cond:
        FAILURES.append(name)


def test_tor_image_pinned_and_current():
    s = open(COMPOSE).read()
    check("tor: EOL 0.4.7.8 is gone", "getumbrel/tor:0.4.7.8" not in s)
    m = re.search(r"image:\s*(ghcr\.io/getumbrel/tor:([0-9.]+)@sha256:[0-9a-f]{64})", s)
    check("tor: pinned by digest on ghcr", bool(m), s[:0])
    if not m:
        return
    ver = [int(x) for x in m.group(2).split(".")]
    # 0.4.8+ is the first series that still bootstraps today
    check(f"tor: version {m.group(2)} is a maintained series",
          ver >= [0, 4, 8], m.group(2))


def test_tor_runs_as_root_on_an_existing_data_dir():
    """Do NOT add `user:` to the tor service. torrc sets DataDirectory /data,
    and existing installs' data/tor is root-owned (created by a root tor
    container years ago). A uid means tor cannot write its own lock/state, so
    the container crash-loops under restart: on-failure -- and because nothing
    depends_on tor, the app still starts and the breakage is silent. That was
    shipped in 29.1.15/16 and removed in 29.1.17."""
    import yaml as _y
    c = _y.safe_load(open(COMPOSE))
    tor = c["services"]["tor"]
    check("tor has no `user:` (would break existing root-owned data/tor)",
          "user" not in tor, tor.get("user"))
    check("nothing depends_on tor (so a tor failure is quiet, not fatal)",
          all("tor" not in (s.get("depends_on") or [])
              for s in c["services"].values()))
    torrc = open(os.path.join(ROOT, "sslabs-bitcoin-cash-node", "torrc")).read()
    check("torrc still writes DataDirectory to the mounted volume",
          "DataDirectory /data" in torrc)


def test_full_mode_is_health_gated():
    s = open(SERVER).read()
    check("gate: SOCKS probe exists", "function torSocksOk" in s)
    check("gate: probe speaks SOCKS5 (0x05,0x01,0x00 greeting)",
          "0x05, 0x01, 0x00" in s)
    m = re.search(r"if \(mode === 'full' && !\(await torSocksOk\(ip\)\)\) \{"
                  r"(.*?)\}", s, re.S)
    check("gate: full mode refuses when Tor is not answering", bool(m))
    if m:
        check("gate: error explains the consequence, not just 'failed'",
              "cut your node off" in m.group(1))
    # the gate must sit BEFORE the config is written, or it gates nothing
    gate = s.find("mode === 'full' && !(await torSocksOk")
    write = s.find("fs.writeFileSync(NODE_CONF")
    check("gate: runs before the conf is written", 0 < gate < write,
          f"gate@{gate} write@{write}")
    # and must not block 'onion'/'off', where a dead Tor is survivable
    check("gate: does not gate onion/off modes",
          "mode === 'full' &&" in s and "mode === 'onion' && !(await" not in s)


def test_socks_probe_behaviour():
    """Run the real probe from server.js against a live fake SOCKS5 server and
    against a dead port. Requires node; skipped on the Umbrel host."""
    if subprocess.run(["which", "node"], capture_output=True).returncode != 0:
        print("SKIP  probe behaviour (node unavailable on this host)")
        return

    def fake_socks(sock, reply):
        conn, _ = sock.accept()
        try:
            conn.recv(16)
            if reply:
                conn.sendall(bytes(reply))
        finally:
            conn.close()

    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 9050))
    srv.listen(1)
    t = threading.Thread(target=fake_socks, args=(srv, [0x05, 0x00]), daemon=True)
    t.start()

    src = open(SERVER).read()
    m = re.search(r"(function torSocksOk\(ip, timeoutMs = 4000\) \{.*?\n\})",
                  src, re.S)
    if not m:
        check("probe: extractable from server.js", False)
        srv.close()
        return
    js = ("const net = require('net');\n" + m.group(1) +
          "\ntorSocksOk(process.argv[2], 1500).then(ok => "
          "{ console.log(ok ? 'OK' : 'NO'); process.exit(0); });\n")
    path = "/tmp/probe_test.js"
    open(path, "w").write(js)
    r = subprocess.run(["node", path, "127.0.0.1"], capture_output=True, text=True)
    check("probe: reports OK against a live SOCKS5 responder",
          r.stdout.strip() == "OK", r.stdout + r.stderr)
    srv.close()

    # nothing listening -> must report NO (this is the dead-Tor case)
    r = subprocess.run(["node", path, "127.0.0.1"], capture_output=True, text=True)
    check("probe: reports NO when nothing is listening (dead Tor)",
          r.stdout.strip() == "NO", r.stdout + r.stderr)


def test_stale_tip_surfaced():
    s = open(SERVER).read()
    check("stale: tip movement is tracked", "function noteTip" in s)
    check("stale: threshold is defined", "STALE_TIP_MS" in s)
    m = re.search(r"const STALE_TIP_MS = ([^;]+);", s)
    if m:
        val = eval(m.group(1), {"__builtins__": {}})
        # BCH targets ~10 min/block: alert between 20 min and 3 h
        check(f"stale: threshold {val/60000:.0f}min is sane",
              20 * 60000 <= val <= 3 * 3600000, val)
    check("stale: exposed on the status API", "tipStale" in s)
    check("stale: suppressed during initial block download",
          "!chain.initialblockdownload" in s)
    check("stale: distinguishes 'not hearing' from 'catching up'",
          "chain.headers <= chain.blocks" in s)
    h = open(INDEX).read()
    check("stale: banner element exists", 'id="staleBanner"' in h)
    check("stale: banner is rendered from status", "d.node.tipStale" in h)
    check("stale: banner warns that mining is wasted",
          "wasted" in h and "stale parent" in h)


def test_tor_error_is_readable_in_ui():
    h = open(INDEX).read()
    check("ui: tor failure text goes to the note, not the button label",
          "torNote" in h and "tn.textContent=(j&&j.error)" in h)



def test_onion_peers():
    """Onion peer directory. Measured 2026-07-15: 23 .onion of 33,048 addresses
    (0.07%), so across 8 outbound slots the expected onion count is ~0.006 --
    "0 via Tor" is arithmetic, not a fault, and waiting never fixes it."""
    srv = open(SERVER).read()
    check("onion: known-address reader exists", "async function onionKnown(" in srv)
    check("onion: reads from getnodeaddresses", "getnodeaddresses" in srv)
    check("onion: sorts by last-seen", "b.time - a.time" in srv)

    # OPT-IN, default OFF -- a silent background dialler is the same failure
    # class as the Tor-only toggle that isolated the node for 15.7h.
    m = re.search(r"function onionPinOn\(\) \{(.*?)\n\}", srv, re.S)
    check("onion: pin defaults OFF when unset",
          bool(m) and "catch (_) { return false; }" in m.group(1))
    r = re.search(r"async function onionReconcile\(\) \{(.*?)\n\}", srv, re.S)
    check("onion: reconciler is a no-op while the toggle is off",
          bool(r) and "if (!onionPinOn()) return;" in r.group(1))

    body = r.group(1) if r else ""
    # `add` maintains/retries; `onetry` would not survive a disconnect
    check("onion: pinned peers use addnode 'add', not 'onetry'",
          "'addnode', [o.address + ':' + o.port, 'add']" in body)
    check("onion: never re-adds an already-connected peer",
          "live.has(o.address)" in body)
    check("onion: each address added at most once per boot (no tight retry)",
          "onionAdded.has(o.address)" in body and "onionAdded.add(o.address)" in body)
    check("onion: respects a maximum", "ONION_PIN_MAX" in body)
    check("onion: stops once enough are live", "live.size >= ONION_PIN_MAX" in body)
    check("onion: re-applies on boot (survives dashboard restart)",
          "setTimeout(() => { onionReconcile()" in srv)
    check("onion: periodic reconcile", "5 * 60 * 1000" in srv)

    # must NOT touch bitcoin.conf: that needs a bitcoind restart
    check("onion: never writes bitcoin.conf (no restart required)",
          "addnode=" not in srv)

    i = srv.index("app.post('/api/onion'")
    ep = srv[i:i + 900]
    check("onion: manual connect validates the address shape",
          "/^[a-z2-7]{56}\\.onion$/i.test" in ep)
    check("onion: manual connect uses onetry (one-shot, not pinned)",
          "'onetry'" in ep)
    check("onion: honest count exposed on status", "out.onion_known" in srv)

    html = open(os.path.join(ROOT, "dashboard", "public", "index.html")).read()
    check("onion: directory is collapsed by default (<details>, no `open`)",
          '<details id="onionBox"' in html and '<details id="onionBox" open' not in html)
    check("onion: toggle present", 'id="onionPin"' in html)
    check("onion: summary reports how many are KNOWN, not just connected",
          "onion known" in html)
    check("onion: explains that 0 is normal for BCH, not a fault",
          "so 0 connected is normal" in html and "not a fault" in html)
    check("onion: states these are additive, not replacements",
          "don't\n        replace your normal peers" in html or "replace your normal peers" in html)
    check("onion: explicitly NOT sold as a privacy feature",
          "This is not a privacy setting" in html)


if __name__ == "__main__":
    print("tor / node-isolation regression tests:")
    test_tor_image_pinned_and_current()
    test_tor_runs_as_root_on_an_existing_data_dir()
    test_full_mode_is_health_gated()
    test_socks_probe_behaviour()
    test_stale_tip_surfaced()
    test_tor_error_is_readable_in_ui()
    test_onion_peers()
    if FAILURES:
        print(f"\n{len(FAILURES)} FAILURE(S): {FAILURES}")
        sys.exit(1)
    print("\nALL TOR TESTS PASSED")
