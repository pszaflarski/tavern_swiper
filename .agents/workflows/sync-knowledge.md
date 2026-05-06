# Sync Knowledge Items

This workflow synchronizes the local repository Knowledge Items (KIs) to the global agent knowledge store. Run this after cloning the repository or after making changes to the rules in `.agents/knowledge/`.

## Instructions

1. Review the changes in `.agents/knowledge/`.
2. Run the sync command below to update the global knowledge store.
3. Once updated, the agent will see these KIs at the start of every new conversation or task.

## Sync Command

// turbo
```bash
# Ensure the destination exists and copy local knowledge to the global store
mkdir -p ~/.gemini/antigravity/knowledge/
cp -r .agents/knowledge/* ~/.gemini/antigravity/knowledge/
```
