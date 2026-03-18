#!/bin/bash
input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name // "unknown"')
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")

# Color: green <70%, yellow 70-89%, red 90%+
if [ "$PCT" -ge 90 ]; then CLR='\033[31m'
elif [ "$PCT" -ge 70 ]; then CLR='\033[33m'
else CLR='\033[32m'; fi

printf "\033[36m%s\033[0m | \033[35m%s\033[0m | ${CLR}ctx %s%%\033[0m | \033[33m\$%.2f\033[0m" "$MODEL" "$BRANCH" "$PCT" "$COST"
