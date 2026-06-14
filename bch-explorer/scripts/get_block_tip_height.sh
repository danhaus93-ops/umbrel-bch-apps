BASE_HEIGHT=$(curl -sk https://explorer.melroy.org/api/v1/blocks/tip/height)
IN_SYNC=true
echo "Base height (my only server): $BASE_HEIGHT"

# Compare it with itself, for now :D
NODE_HEIGHT=$(curl -sk https://explorer.melroy.org/api/v1/blocks/tip/height)
echo $(echo https://explorer.melroy.org) - $NODE_HEIGHT
if [ "$NODE_HEIGHT" -ne "$BASE_HEIGHT" ]; then
  COUNT=$((BASE_HEIGHT-NODE_HEIGHT))
  echo $(echo https://explorer.melroy.org) is not in sync. delta: $COUNT
  IN_SYNC=false
fi

if [ "$IN_SYNC" = false ]; then
  echo "One or more servers are out of sync. Check the logs."
  exit -1
else
  echo "All servers are in sync."
fi

