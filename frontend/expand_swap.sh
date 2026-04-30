#!/bin/bash
# Script to expand swap to 16GB to prevent OOM errors during Android builds

SWAP_FILE="/swap.img"

echo "Current swap status:"
swapon --show

echo "Step 1: Disabling swap..."
sudo swapoff $SWAP_FILE

echo "Step 2: Resizing swap to 16GB (this may take a minute)..."
sudo fallocate -l 16G $SWAP_FILE

echo "Step 3: Formatting swap..."
sudo mkswap $SWAP_FILE

echo "Step 4: Re-enabling swap..."
sudo swapon $SWAP_FILE

echo "Done! New swap status:"
free -h
swapon --show
