# Exported to dependent apps (Fulcrum, SoloStrike Cash) by umbrelOS.
# RPC user stays static; the password is derived from this install's unique
# APP_SEED, so every Umbrel gets its own secret without it living in git.
export APP_GAVIN_BITCOIN_CASH_NODE_RPC_USER="bchn"
export APP_GAVIN_BITCOIN_CASH_NODE_RPC_PASS="${APP_SEED:-bchn_local_rpc_pw_2f9c}"
