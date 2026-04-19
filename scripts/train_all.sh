#!/usr/bin/env bash
# Train the full 6-model ensemble: 2 architectures × 3 seeds.
# Run from the project root: bash scripts/train_all.sh
#
# RTX 5070 estimate: ~30-50 min total (lstm_v2 faster, patchtst heavier).
# Add --skip-fetch after first run to avoid re-downloading data.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

SKIP_FETCH="${1:-}"  # pass "--skip-fetch" as first arg after first run

echo "=== Stock-Predictor Ensemble Training ==="
echo "  Project root: $PROJECT_ROOT"
echo "  Started: $(date)"
echo ""

TOTAL_START=$(date +%s)

for MODEL in lstm_v2 patchtst; do
    for SEED in 1 2 3; do
        echo "──────────────────────────────────────────"
        echo "  ▶  $MODEL  seed=$SEED"
        echo "──────────────────────────────────────────"
        START=$(date +%s)
        python -m src.train --model "$MODEL" --seed "$SEED" $SKIP_FETCH
        END=$(date +%s)
        echo "  ✓  Done in $(( (END - START) / 60 ))m $(( (END - START) % 60 ))s"
        echo ""
        # After first model/seed the data is already loaded into Python process;
        # for subsequent runs we can skip re-fetching (data in RAM is gone between
        # processes, but feature caching via pyarrow would help here — see docs).
        SKIP_FETCH="--skip-fetch"
    done
done

TOTAL_END=$(date +%s)
TOTAL=$(( TOTAL_END - TOTAL_START ))
echo "=== All 6 models trained in ${TOTAL}s ($(( TOTAL / 60 ))m) ==="
echo "  Checkpoints: $PROJECT_ROOT/models/ensemble/"
echo "  Next: python -m src.evaluate"
