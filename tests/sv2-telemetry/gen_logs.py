#!/usr/bin/env python3
"""Generate synthetic pool_sv2 logs replaying every real-world failure mode
the SV2 telemetry engine has survived in production."""
import random, sys, os
random.seed(7)
D1 = 0xffff << 208
OUT = sys.argv[1] if len(sys.argv) > 1 else "fixtures"
def emit(lines, t0, dur, rate, tdiff, seq0, junk=0):
    seq = seq0
    T = int(D1 / tdiff)
    n = int(dur * rate)
    for i in range(n):
        ts = t0 + i / rate
        stamp = f"2026-01-01T{int(ts//3600):02d}:{int(ts//60)%60:02d}:{ts%60:06.3f}Z"
        if seq % 10 == 0:
            lines.append(f"{stamp}  INFO pool_sv2::...: SubmitSharesExtended: SubmitSharesSuccess(channel_id=2, last_sequence_number={seq}, new_submits_accepted_count=10, new_shares_sum=0)")
        else:
            h = random.randrange(1, T)
            lines.append(f"{stamp}  INFO pool_sv2::channel_manager::mining_message_handler: SubmitSharesExtended: valid share | downstream_id: 1, channel_id: 2, sequence_number: {seq}, share_hash: {h:064x}, share_work: 0.00000000023282709094019083")
        seq += 1
    for j in range(junk):
        ts = t0 + dur - 1 - j
        stamp = f"2026-01-01T{int(ts//3600):02d}:{int(ts//60)%60:02d}:{ts%60:06.3f}Z"
        h = int(D1 / 14.0) - j
        lines.append(f"{stamp}  INFO pool_sv2::channel_manager::mining_message_handler: SubmitSharesExtended: valid share | downstream_id: 1, channel_id: 2, sequence_number: {seq}, share_hash: {h:064x}, share_work: 0.00000000023282709094019083")
        seq += 1
    return seq
os.makedirs(OUT, exist_ok=True)
# scenario 1: threshold doubles mid-window + batch acks (true 44.12 TH/s)
L = []
s = emit(L, 0, 120, 34.0, 280.0, 150000)
emit(L, 120, 120, 17.0, 560.0, s)
open(f"{OUT}/threshold_shift.log", "w").write("\n".join(L) + "\n")
# scenario 2: mid-bucket sequence reset (reconnect), true 37.4 TH/s delivered
L = []
emit(L, 0, 240, 34.0, 256.0, 150000)
emit(L, 240, 60, 34.0, 256.0, 1)
open(f"{OUT}/seq_reset.log", "w").write("\n".join(L) + "\n")
# scenario 3: junk shares on a floor channel (true 2.41 TH/s at diff 280, 2/s)
L = []
emit(L, 0, 300, 2.0, 280.0, 1, junk=2)
open(f"{OUT}/junk_floor.log", "w").write("\n".join(L) + "\n")
# scenario 4: vardiff channel - pool credits real work (share_work = target
# diff), every 10th share batch-acked. true = rate x diff x 2^32
L = []
seq = 1
T4D = 16507.0
for i in range(int(300 * 0.62)):
    ts = i / 0.62
    stamp = f"2026-01-01T{int(ts//3600):02d}:{int(ts//60)%60:02d}:{ts%60:06.3f}Z"
    if seq % 10 == 0:
        L.append(f"{stamp}  INFO pool_sv2::...: SubmitSharesExtended: SubmitSharesSuccess(channel_id=2, last_sequence_number={seq}, new_submits_accepted_count=10, new_shares_sum=0)")
    else:
        h = random.randrange(1, int(D1 / T4D))
        L.append(f"{stamp}  INFO pool_sv2::channel_manager::mining_message_handler: SubmitSharesExtended: valid share | downstream_id: 1, channel_id: 2, sequence_number: {seq}, share_hash: {h:064x}, share_work: {T4D}")
    seq += 1
open(f"{OUT}/vardiff_credited.log", "w").write("\n".join(L) + "\n")
print("fixtures written to", OUT)
