# Mode Profiles and Automatic Progress Design

## Purpose

Extend Tarkov Operations Companion from a local quest prototype into a trustworthy multi-mode companion. A user registers a separate Escape from Tarkov nickname for PvP, PvE, and Seasonal PvP. The application links each nickname to a stable Tarkov.dev account identifier, keeps progress isolated by mode, reads supported local EFT logs, and refreshes available profile data every minute.

The product must distinguish confirmed source data from inferred or manually entered state. It must not claim to know inventory, quest, or hideout state that cannot be obtained reliably.

## Scope

This implementation covers:

- mode-specific profile registration and switching;
- PvP, PvE, and Seasonal PvP data models;
- Tarkov.dev player lookup and profile refresh through an application-owned service boundary;
- automatic EFT log discovery, incremental scanning, and mode-aware event routing;
- computed quest availability and prerequisite inference;
- dashboard and raid-planning changes;
- merging Economy, Keys, and Ammunition into Flea Market;
- trader selection cards;
- an interactive top-down hideout view with manual station levels;
- one-minute synchronization scheduling and freshness reporting.

Payment, subscription enforcement, production hosting, and a complete cloud account system are separate projects. The client/server boundary in this design must not prevent those additions.

## Product Truthfulness Rules

1. Every player-derived value records its source and source timestamp.
2. The UI says "updated" only when the upstream snapshot actually changed or a local log event was processed.
3. Stale or unavailable data remains visible with a freshness warning instead of being replaced by guesses.
4. The app never reads EFT process memory, injects code, intercepts protected traffic, or automates gameplay.
5. Backpack, rig, pockets, secure-container, and stash readiness are not inferred from local logs. The inspected logs do not contain a reliable current inventory snapshot for the local player.
6. The app may show a requirements checklist for a raid, but it must not claim that the player currently carries those items.
7. Hideout station levels are manual until a reliable authorized player-specific source exists.

## Mode Model

The application has one local application identity containing three independent mode slots:

- `pvp`, mapped to Tarkov.dev `regular`;
- `pve`, mapped to Tarkov.dev `pve`;
- `seasonal`, mapped to Tarkov.dev `pvp-season`.

Each mode slot owns its own:

- registration state;
- entered nickname;
- confirmed Tarkov.dev nickname;
- stable numeric Tarkov account ID;
- level, total experience, faction, prestige, and profile freshness;
- task progress and inference metadata;
- hideout station levels;
- selected map, favorites, and mode-scoped planning preferences.

Switching to an unregistered mode opens mode registration. Switching to a registered mode loads that mode immediately. A newly detected game session may automatically select its mode. If that mode is not registered, the app opens registration without writing progress into another mode.

## Mode Registration

Registration flow:

1. The user selects a mode.
2. The user enters a nickname, such as `shaurma`.
3. The service searches Tarkov.dev within that mode only.
4. The UI shows matching candidates with nickname, level, faction, and account ID.
5. The user confirms one result.
6. The app stores the stable numeric account ID and the canonical nickname returned by the source.

After confirmation the nickname is read-only. "Change profile" is an explicit destructive rebind flow. It warns that the mode's existing local progress belongs to the old binding and offers export before replacement. Other mode slots are not affected.

When logs expose an account ID, the app compares it with the registered ID. A mismatch never silently overwrites the binding or imports events. The UI asks the user to confirm the correct profile.

## Player Profile Refresh

The desktop client talks to an application-owned profile service rather than relying on direct browser access to Tarkov.dev. The service:

- resolves nickname searches per mode;
- retrieves player snapshots by stable account ID;
- applies rate limiting, request coalescing, and short-lived caching;
- records upstream timestamps and service fetch timestamps separately;
- returns a normalized, versioned player-profile response.

The selected mode requests refresh every 60 seconds while the app is open. Background modes refresh when selected or when their local logs receive a new event. A one-minute client schedule does not imply that Tarkov.dev changed the underlying snapshot every minute.

Authoritative profile fields include only fields present in the normalized source, such as nickname, experience-derived level, faction, prestige, skills, public statistics, and equipment when supplied. Player level cannot be edited manually. If profile refresh fails, the last valid level remains with a stale warning.

## Local Log Synchronization

The existing mixed-mode warning is replaced by session-aware parsing.

The scanner groups files by EFT log-session directory. It derives the session mode, account/profile identifiers, timestamps, and task notifications within that session before combining results. Events are then partitioned by mode instead of merging all historical sessions into one ambiguous result.

Supported task notification states remain:

- started;
- failed;
- completed.

Automatic discovery scans the known EFT `Logs` folder. A manual folder picker remains available. After initial import, incremental synchronization processes only new or changed log content. Filesystem notifications trigger a prompt refresh and a 60-second reconciliation scan handles missed notifications.

If an event has no trustworthy mode, it is held in an unresolved queue and is not applied automatically. Duplicate events are deduplicated by mode, task, status, and timestamp. A completed task cannot be downgraded by an older non-manual event.

Seasonal events are stored only in the currently supported active seasonal slot. Seasonal resets create a new season identity rather than mixing progress across seasons.

## Quest Progress Engine

The quest page opens on `Available`. The former `Active` tab is removed.

Quest states are calculated from:

- confirmed task events;
- the authoritative player level;
- faction and mode;
- task prerequisite/status requirements from current game data;
- manual corrections, with clear source labeling;
- conservative prerequisite-chain inference.

If a confirmed completed task requires earlier tasks to be completed, those prerequisite tasks may be marked `inferred completed`. The engine follows only explicit dependency rules from the data and does not infer unrelated branches. Direct evidence always overrides inference. The UI distinguishes confirmed and inferred completion and allows the user to inspect why a state was inferred.

`Available` means all known level, faction, mode, and prerequisite gates are satisfied. Unknown requirements keep the task in an explanatory uncertain state instead of making it available.

Kappa progress counts only current-mode tasks marked as Kappa requirements. The dashboard displays completed Kappa tasks and how many remain.

## Dashboard and Raid Plan

The Overview page contains only defensible metrics:

- available tasks;
- completed tasks;
- remaining Kappa tasks;
- available/current tasks on the selected map;
- latest synchronization time and source state.

The inventory-based readiness percentage is removed. A "Take with you" list may show quest-required items, keys, markers, and consumables for the selected map, but it is a planning checklist rather than an inventory assertion.

The PvP/PvE/Seasonal raid-plan card provides:

- Build route;
- Tasks;
- Select map.

Selecting a map expands the map choices within the same card. Maps locked by a known progression rule display a lock. Hovering or focusing the lock shows only the task name required to unlock it. Maps without a verified lock rule remain available.

Map priority is sorted by the number of current actionable tasks for that map, not by the total number of tasks in the catalog.

## Maps and Routing

Map markers continue to use live map geometry and distinct layers. Default visibility remains:

- PMC, Scav, and co-op extracts;
- transits;
- quest objectives;
- quest items.

Ordinary loot remains disabled by default and separated by loot category. Quest markers are filtered to current-mode actionable tasks when opened from the raid plan. Route building operates only on known task markers, required-item locations, and valid exits; it does not invent coordinates for tasks without map data.

## Flea Market

The navigation entries Economy, Keys, and Ammunition are replaced with one `Flea Market` section. It contains tabs for:

- all items;
- keys;
- ammunition;
- favorites.

Search, sorting, price sources, item details, quest use, and hideout use remain available. Prices and trader offers use the selected game mode. Shared server caching supplies current catalog data without every desktop client repeatedly requesting the same upstream payload.

## Traders

The Traders page initially provides a grid of in-game-style trader portrait cards. Selecting a card opens a minimal trader overview containing the portrait, name, role, and an explicit notice that detailed trader data is not part of this release. Trader progression and offer logic are deferred.

## Hideout

The Hideout page uses a top-down schematic inspired by the in-game entrance view without copying proprietary UI assets. Each station is placed in a stable visual location and shows its manually selected current level.

Selecting a station opens a compact panel containing:

- current level;
- next level;
- required items and quantities;
- trader, skill, task, and station prerequisites;
- bonuses unlocked by the next level;
- source-data freshness.

Station definitions and requirements update automatically from current game data. The player's station level is manual and mode-specific because neither inspected EFT logs nor the supported public profile snapshot provides a reliable current hideout state. The UI labels it `set by player`.

## Synchronization Schedule

While the desktop app is open:

- filesystem changes trigger incremental log parsing;
- a 60-second reconciliation checks the watched log folder;
- the selected player profile is checked every 60 seconds through the service;
- UI state recomputes immediately after accepted profile or log changes;
- shared game catalog and market data use server-controlled cache lifetimes and stale-while-revalidate behavior.

The sync indicator distinguishes:

- local log update time;
- player snapshot upstream time;
- player snapshot fetch time;
- game catalog update time;
- market price update time.

## Data Boundaries and Future Subscription Architecture

The desktop application remains a thin client:

- local log reading and safe normalization happen on the PC;
- raw logs remain local by default;
- normalized events may be sent to the application service after explicit account authentication;
- game databases, entitlement checks, subscription logic, and expensive computation live on the server;
- the client receives only the data required for its current views.

This reduces bulk extraction risk but cannot make data shown to an authorized client impossible to copy. Server-side authorization, short-lived tokens, rate limiting, device/session controls, auditing, and response minimization are required for a paid product.

## Failure Handling

- Nickname search failure leaves registration incomplete and offers retry.
- Multiple nickname matches require explicit confirmation.
- Profile mismatch with local logs pauses imports for that mode.
- Tarkov.dev rate limits preserve cached data and show a retry time.
- Unknown log modes enter the unresolved queue.
- Missing map coordinates hide the marker rather than place it arbitrarily.
- Missing hideout progress keeps the station level unconfirmed.
- A stale player snapshot never silently changes a newer confirmed local task state.

## Migration

Existing schema-version-2 profiles migrate as follows:

- current PvP and PvE mode progress is preserved;
- existing display name becomes an application-local label, not a verified Tarkov nickname;
- mode slots start as unregistered until nickname/account binding succeeds;
- Seasonal receives a new empty slot;
- manually edited player level is retained only as legacy evidence and is replaced when the first authoritative profile snapshot succeeds;
- existing hideout levels remain manual mode-specific levels;
- existing task records retain their original source labels.

## Testing and Acceptance Criteria

Automated tests must cover:

- independent registration and data isolation for all three modes;
- nickname lookup and stable account-ID binding;
- nickname rebind warnings and non-impact on other modes;
- session-aware parsing of mixed historical PvP/PvE/Seasonal logs;
- account mismatch rejection;
- incremental log deduplication;
- authoritative level updates and stale snapshot behavior;
- conservative prerequisite inference;
- Available as the default quest view with no Active tab;
- Kappa remaining count;
- actionable quest counts per map;
- map lock tooltips and verified unlock rules;
- the merged Flea Market navigation and tabs;
- trader-card selection;
- mode-specific manual hideout levels and current requirements;
- removal of inventory-readiness claims;
- one-minute scheduling using fake timers;
- packaged Electron preload and IPC behavior;
- production Windows portable build launch.

Acceptance requires a clean typecheck, lint, unit test suite, browser end-to-end suite, packaged Electron smoke test, and a new portable EXE copied to the project outputs and the user's Desktop.
