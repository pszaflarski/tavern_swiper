# Fandom-Driven Tags & Character Creator Wizard

> **Status**: Implemented on feature branch `implement-character-creation-wizard` (Not yet merged to `dev` / `test` / `prod`)
> **Branch**: `implement-character-creation-wizard`
> **Context**: The React Native wizard screen flow, styles, and API integrations are complete. Jest unit/integration tests and Maestro E2E test specs have been created. The backend routing configuration has been pushed to `dev`, but all frontend changes remain isolated on the feature branch for verification.

## Problem

Not all fandoms share the same tag categories. D&D has "class" (Fighter, Wizard, Paladin). Genshin has "element" and "weapon type". Warhammer has "faction" — and some Warhammer races are genderless, meaning the `gender` step should be skipped entirely.

Hardcoding a `class` field on the profile model would be D&D-specific and wouldn't generalize.

## Recommendation: Frontend-Driven Steps + `other_tags`

### How it works

1. **Fandom selection drives which wizard steps appear.** The wizard renders different step sequences based on the chosen fandom:

   | Fandom | Wizard Steps |
   |--------|-------------|
   | D&D | Fandom → Gender → Race → Class → Result |
   | Warhammer | Fandom → Faction → Subfaction → Result |
   | Genshin | Fandom → Gender → Element → Weapon → Result |

2. **Fandom-specific attributes go into `other_tags`.** The existing `other_tags` field on `ProfileCreate` is a `map[string][]ProfileTag` — a dynamic key-value map of tag categories. This is exactly the right place:

   ```json
   {
     "display_name": "Garok Ironbound",
     "fandom": [{"id": "f-1", "category": "fandom", "name": "D&D", "slug": "dnd"}],
     "gender": [{"id": "g-1", "category": "gender", "name": "Male", "slug": "male"}],
     "race": [{"id": "r-1", "category": "race", "name": "Orc", "slug": "orc"}],
     "other_tags": {
       "class": [{"id": "c-1", "category": "class", "name": "Paladin", "slug": "paladin"}]
     }
   }
   ```

3. **Universal fields (`gender`, `race`) are optional.** If a fandom doesn't use gender (e.g., Warhammer orks), the wizard simply skips that step. The resulting profile has `gender: []`. The backend already handles this — all tag fields except `display_name` are optional on `ProfileCreate`.

4. **Step options are defined per-fandom in the frontend.** The existing pattern in the example wizard already does this:

   ```typescript
   // Already in StepRace.tsx and StepClass.tsx
   const RACE_OPTIONS_BY_FANDOM: Record<string, Option[]> = {
     'D&D': [...],
     'Genshin': [...],
   };
   ```

   This pattern extends naturally to new fandom-specific categories.

### What stays the same (no backend changes needed)

- `ProfileCreate` model — `other_tags` already supports arbitrary categories
- `ProfileUpdate` model — same
- `ProfileOut` model — `other_tags` already serializes back
- Tag validation in `handleCreateProfile` — already validates tags from `other_tags`
- Discovery/matching — `other_tags` are already stored and queryable

### What changes

#### Frontend (React Native wizard)

| File | Change |
|------|--------|
| New screen: `app/character-wizard.tsx` | Full-screen wizard route, not dismissible until profile is created |
| New components per step | Port from `examples/character_creator/` to React Native equivalents |
| Step sequencing logic | Fandom → lookup which steps to show → render dynamically |
| Preset data | Port `characters.ts` presets into the React Native app, with GCS image URLs instead of local paths |

#### Backend (profiles_go)

| Item | Change |
|------|--------|
| None required | `other_tags` already handles arbitrary fandom-specific categories |

#### Data / Infrastructure

| Item | Change |
|------|--------|
| Sample character images | Upload the 23 images from `sample_characters/` to a public GCS bucket so the wizard can reference them as `image_urls` |
| Tag seeds | Ensure fandom-specific tags (e.g., `class:paladin`, `class:fighter`) exist in the `tags` collection so validation passes |

### Future: Tag Catalog Metadata (when adding a 2nd fandom)

When a second fandom is unlocked, consider adding a `fandom_scope` field to tag documents in Firestore:

```json
{
  "id": "tag-paladin",
  "category": "class",
  "name": "Paladin",
  "slug": "paladin",
  "fandom_scope": ["D&D"],
  "status": "active"
}
```

This would enable a `GET /profiles/tags?category=class&fandom=D&D` endpoint that returns only relevant options, allowing the wizard to be fully data-driven without frontend updates per fandom. But this is **not needed for the first implementation** — only when you actually ship a second fandom.

### Preset Images

The 23 character images in `sample_characters/` need to be hosted in GCS before the wizard can use them in production. The wizard would set `image_urls` to the public GCS URL when creating a profile from a preset. The `is_oc` field should be set to `false` for wizard-generated profiles.

### Open Questions

1. **Should users be able to "re-roll" their wizard profile later?** i.e., delete it and go through the wizard again, or is the wizard strictly a first-time-only flow?
2. **Can users customize wizard-generated profiles after creation?** e.g., edit the bio or swap the image via the existing profile edit screen?
3. **Should the preset pool be randomized or deterministic?** Currently the wizard shows the highest-scoring match first. Should it shuffle results so two users picking the same options don't always get the same character?
