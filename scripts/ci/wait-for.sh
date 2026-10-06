#!/usr/bin/env bash
# Waits for a background step of the CI workflow ("supabase" or "browsers") to finish, then fails
# with its log if it failed. Gives up after 8 minutes (the job itself stops at 15).
set -euo pipefail
name="$1"
exit_file="$RUNNER_TEMP/$name.exit"
for _ in $(seq 1 480); do
  [ -f "$exit_file" ] && break
  sleep 1
done
if [ ! -f "$exit_file" ]; then
  echo "::error::$name did not finish in 8 minutes"
  tail -n 50 "$RUNNER_TEMP/$name.log" || true
  exit 1
fi
code="$(cat "$exit_file")"
if [ "$code" != "0" ]; then
  echo "::error::$name failed (exit $code)"
  tail -n 80 "$RUNNER_TEMP/$name.log" || true
  exit 1
fi
echo "$name ready."
