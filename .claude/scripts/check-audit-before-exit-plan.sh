#!/bin/bash
# Remind Claude to complete audit passes before exiting plan mode
# This hook fires on every ExitPlanMode call and outputs a checklist
# that Claude processes as user feedback before proceeding.

echo "AUDIT GATE: Before exiting plan mode, verify:"
echo "  1. Architecture review findings have been presented and addressed"
echo "  2. Test specifications are included in the plan (not just a coverage checklist)"
echo "  3. All audit passes are complete (not just the first pass)"
echo "  4. User has explicitly approved proceeding to implementation"
echo ""
echo "If any of these are incomplete, do NOT exit plan mode — continue the review."

exit 0
